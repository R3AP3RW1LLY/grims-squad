import { Injectable, Inject } from '@nestjs/common';
import { PrismaClient } from '@grims/db';
import { AppError, ErrorCode } from '@grims/shared';
import type { PairingService } from './pairing.service.js';
import { PAIRING_SERVICE } from './telemetry.tokens.js';
import {
  LINK_TTL_MS,
  canApprove,
  hashSecret,
  newCode,
  newPollSecret,
  normaliseCode,
  pollState,
  type PollState,
} from './device-link.js';

/**
 * Running the link flow.
 *
 * The rules live in `device-link.ts` and are tested there; this is the part that talks to the
 * database. Kept apart because the ORDER of the state checks is the security property, and a rule
 * that can only be exercised through a database is a rule nobody exercises.
 */

/** What the app is told when it starts a link. */
export interface LinkStart {
  readonly code: string;
  /** Only the app ever sees this. It is what collects the token. */
  readonly pollSecret: string;
  readonly expiresAt: Date;
}

@Injectable()
export class DeviceLinkService {
  constructor(
    @Inject(PrismaClient) private readonly db: PrismaClient,
    @Inject(PAIRING_SERVICE) private readonly pairing: PairingService,
  ) {}

  /**
   * The app asks to be linked. No authentication — there is nobody to authenticate yet.
   *
   * ★ THIS ENDPOINT IS OPEN, AND THAT IS SAFE ★
   *
   * Anybody can create a pending link. It grants nothing: a link is inert until a signed-in member
   * approves that specific code in a browser, and the caller cannot approve their own. The worst an
   * abuser achieves is rows that expire in ten minutes.
   *
   * What it must NOT do is leak whether a code exists, which is why approval is by code and the
   * lookup answers the same way for absent and expired.
   */
  async start(rawLabel: string, now: Date = new Date()): Promise<LinkStart> {
    const label = rawLabel.trim().slice(0, 60) || 'Companion app';
    const pollSecret = newPollSecret();
    const expiresAt = new Date(now.getTime() + LINK_TTL_MS);

    /*
     * Retried on collision. The code space is 3.7e11 and the live window is ten minutes, so this
     * effectively never fires — but `code` is UNIQUE, and an unhandled collision would surface as a
     * raw database error to a member trying to sign in.
     */
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = newCode();
      try {
        await this.db.deviceLink.create({
          data: { code, pollSecretHash: hashSecret(pollSecret), label, expiresAt },
        });
        return { code, pollSecret, expiresAt };
      } catch {
        // Collision, or a transient write failure. Either way the next code is a fresh draw.
      }
    }

    throw new AppError(ErrorCode.INTERNAL_ERROR, 'Could not start a link. Try again.');
  }

  /**
   * What the approval page shows before anybody commits to anything.
   *
   * Deliberately thin: the label and when it expires. It must not reveal whether the code was ever
   * valid in a way that distinguishes "wrong code" from "expired code" — both are simply "not
   * available", because the difference is only useful to somebody guessing.
   */
  async describe(rawCode: string, now: Date = new Date()): Promise<{ label: string } | null> {
    const code = normaliseCode(rawCode);
    if (code === '') return null;

    const link = await this.db.deviceLink.findUnique({ where: { code } });
    if (link === null || !canApprove(link, now)) return null;
    return { label: link.label };
  }

  /**
   * A signed-in member approves a code.
   *
   * This is where the account is bound and the device token is minted. The member is authenticated
   * by their ordinary session cookie — the same Discord sign-in they already have — which is the
   * whole point of doing it in a browser rather than in the app.
   */
  async approve(userId: string, rawCode: string, now: Date = new Date()): Promise<{ label: string }> {
    const code = normaliseCode(rawCode);
    if (code === '') {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'That code is not valid.');
    }

    const link = await this.db.deviceLink.findUnique({ where: { code } });
    if (link === null || !canApprove(link, now)) {
      /*
       * One message for "never existed", "already approved" and "expired".
       *
       * Distinguishing them tells somebody working through codes which guesses were real, and the
       * member's remedy is identical in all three cases: start again in the app.
       */
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        'That code is not available. Start again in the app for a fresh one.',
      );
    }

    // Mints against the member's own device limit, so linking cannot be used to exceed it.
    const paired = await this.pairing.pair(userId, link.label);

    /*
     * ★ CONDITIONAL UPDATE, NOT A PLAIN ONE ★
     *
     * Two browser tabs approving the same code at the same moment would both pass `canApprove`
     * above and both mint a device. Requiring `approvedAt` to still be null makes the second write
     * touch zero rows, so only one wins — and the loser's device is revoked rather than left as a
     * ghost the member cannot explain.
     */
    const claimed = await this.db.deviceLink.updateMany({
      where: { id: link.id, approvedAt: null },
      data: {
        userId,
        approvedAt: now,
        deviceTokenId: paired.deviceId,
        tokenOnce: paired.token,
      },
    });

    if (claimed.count === 0) {
      // Silent: this device lost the race before the member ever saw it, and a "device
      // unlinked" notice about a ghost would read as somebody else acting on their account.
      await this.pairing
        .revoke(userId, paired.deviceId, new Date(), { silent: true })
        .catch(() => undefined);
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'That code has already been used.');
    }

    return { label: link.label };
  }

  /**
   * The app collects its token.
   *
   * ★ AUTHENTICATED BY THE SECRET, NOT BY THE CODE ★
   *
   * The code is on screen and may have been read by anybody in the room. The secret was generated
   * for this app and never displayed, so it is the only thing that proves the caller is the app
   * that started the link.
   */
  async poll(rawCode: string, pollSecret: string, now: Date = new Date()): Promise<PollState> {
    const code = normaliseCode(rawCode);
    if (code === '' || pollSecret === '') return { status: 'expired' };

    const link = await this.db.deviceLink.findUnique({ where: { code } });
    // A wrong secret is answered exactly like a missing link: a poller who has the code but not the
    // secret learns nothing about whether the code is real.
    if (link === null || link.pollSecretHash !== hashSecret(pollSecret)) {
      return { status: 'expired' };
    }

    const state = pollState(link, now);
    if (state.status !== 'approved') return state;

    /*
     * Marked collected in the same breath as being handed over, and conditionally — so two polls
     * racing each other cannot both receive it. The second sees zero rows updated and is told the
     * link is gone, which is true.
     */
    const taken = await this.db.deviceLink.updateMany({
      where: { id: link.id, collectedAt: null },
      data: { collectedAt: now, tokenOnce: null },
    });
    if (taken.count === 0) return { status: 'gone' };

    return state;
  }

  /**
   * Clears out links nobody finished.
   *
   * Rows carry a token between approval and collection. One that is never collected must not sit in
   * the table indefinitely holding a working credential.
   */
  async sweep(now: Date = new Date()): Promise<number> {
    const { count } = await this.db.deviceLink.deleteMany({
      where: { expiresAt: { lt: new Date(now.getTime() - LINK_TTL_MS) } },
    });
    return count;
  }
}

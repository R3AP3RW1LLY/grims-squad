import { AppError, ErrorCode } from '@grims/shared';
import {
  BANNER,
  validateBannerSpec,
  type BannerSpec,
  SIGNATURE_ACCENTS,
  SIGNATURE_LABEL_MAX,
  SIGNATURE_TAGLINE_MAX,
  isAllowedSignatureLink,
  type SignatureAccent,
  type SignatureInput,
  type SignatureView,
} from '@grims/shared';
import type { AclBoundClient } from '../authz/acl-db.service.js';

/**
 * Forum signatures.
 *
 * ★ THE ONE RULE THAT SHAPES THIS WHOLE FILE ★
 *
 * Squadron owner, 2026-07-30: the signature avatar "should only be displayed on the forums and not
 * replace their global avatar that discord imports".
 *
 * Nothing here writes `User.avatarStoredHash`. Not once, not as a convenience, not "so the roster
 * matches". The Discord import owns that column, and a second writer would produce a picture that
 * changes on its own every time the sync runs — a bug the member cannot even describe.
 *
 * ★ IMAGES ARE VERIFIED TO BE THEIRS ★
 *
 * A media id arrives from a browser, so `#ownedUpload` checks the uploader before it is stored.
 * Without that, a member could point their signature at somebody else's upload id — which is not a
 * privacy breach (uploads are served to members anyway) but is somebody else's picture appearing
 * under a stranger's name on every post they write.
 */
export class SignatureService {
  /**
   * The caller's own signature, or nulls.
   *
   * Absent is a real answer, not an error: a member who has never opened the tab has no row, and
   * their signature is the default built from their Discord avatar.
   */
  async mine(db: AclBoundClient, userId: string): Promise<SignatureView> {
    const row = await db.forumSignature.findUnique({ where: { userId } });
    return toView(row, null);
  }

  /**
   * Saves a partial signature.
   *
   * ★ UPSERT, AND EVERY FIELD OPTIONAL ★
   *
   * The editor saves one control at a time. A PUT that required the whole object would mean a
   * client that forgot a field silently cleared it — and the field most often forgotten would be
   * the avatar, which is the one thing a member would notice and be unable to explain.
   */
  async save(db: AclBoundClient, userId: string, input: SignatureInput): Promise<SignatureView> {
    const patch: Record<string, unknown> = {};

    if (input.tagline !== undefined) {
      patch['tagline'] = clean(input.tagline, SIGNATURE_TAGLINE_MAX, 'Tagline');
    }
    if (input.bannerLabel !== undefined) {
      patch['bannerLabel'] = clean(input.bannerLabel, SIGNATURE_LABEL_MAX, 'Banner label');
    }

    if (input.bannerUrl !== undefined) {
      const url = typeof input.bannerUrl === 'string' ? input.bannerUrl.trim() : '';
      if (url === '') {
        patch['bannerUrl'] = null;
      } else if (!isAllowedSignatureLink(url)) {
        /*
         * The message NAMES the destinations rather than saying "invalid link". Somebody pasting
         * their Twitch channel and being told "no" with no reason will try three more times and
         * then report it as broken.
         */
        throw new AppError(
          ErrorCode.VALIDATION_FAILED,
          'A signature banner can link to your Inara or EDSM commander page, your Twitch, YouTube or Kick channel, or elitedangerous.com. It has to be an https link.',
        );
      } else {
        patch['bannerUrl'] = url;
      }
    }

    if (input.accent !== undefined) {
      if (!(SIGNATURE_ACCENTS as readonly string[]).includes(input.accent)) {
        throw new AppError(ErrorCode.VALIDATION_FAILED, 'That is not one of our colours.');
      }
      patch['accent'] = input.accent;
    }

    for (const flag of ['showRank', 'showCommander', 'enabled'] as const) {
      if (input[flag] !== undefined) patch[flag] = input[flag] === true;
    }

    if (input.bannerSpec !== undefined) {
      if (input.bannerSpec === null) {
        patch['bannerSpec'] = null;
      } else {
        /*
         * Validated here rather than trusted, even though it was built by our own editor. The
         * editor is JavaScript in a browser: what arrives is whatever the browser sent, and a spec
         * is a small program describing what to draw. `validateBannerSpec` clamps every number and
         * refuses every structure it does not recognise.
         */
        try {
          patch['bannerSpec'] = validateBannerSpec(input.bannerSpec) as unknown as object;
        } catch (e) {
          throw new AppError(ErrorCode.VALIDATION_FAILED, (e as Error).message);
        }
      }
    }

    if (input.avatarMediaId !== undefined) {
      patch['avatarMediaId'] = await this.#ownedUpload(db, input.avatarMediaId, userId);
    }
    if (input.bannerMediaId !== undefined) {
      patch['bannerMediaId'] = await this.#ownedUpload(db, input.bannerMediaId, userId, 'banner');
    }

    const row = await db.forumSignature.upsert({
      where: { userId },
      create: { userId, ...patch },
      update: patch,
    });

    return toView(row, null);
  }

  /**
   * Signatures for a set of members, for rendering a thread.
   *
   * ★ ONE QUERY FOR THE PAGE ★
   *
   * A thread with forty replies from twelve people is twelve signatures, not forty — deduplicated
   * by the caller. Fetching per post would be forty queries to render one page, and the same
   * member's block twelve times over.
   *
   * Disabled signatures are excluded HERE rather than filtered by the renderer, so a member who
   * turned theirs off cannot have it appear because some future consumer forgot to check.
   */
  async forUsers(db: AclBoundClient, userIds: readonly string[]): Promise<Map<string, SignatureView>> {
    if (userIds.length === 0) return new Map();

    const rows = await db.forumSignature.findMany({
      where: { userId: { in: [...userIds] }, enabled: true },
    });

    return new Map(rows.map((r) => [r.userId, toView(r, null)]));
  }

  /**
   * Resolves a media id the client sent, or null.
   *
   * ★ THE UPLOADER CHECK IS THE POINT ★
   *
   * Ids arrive from a browser. Without this, a member could set their signature avatar to somebody
   * else's upload — their face under a stranger's name, on every post that stranger writes.
   */
  async #ownedUpload(
    db: AclBoundClient,
    mediaId: string | null | undefined,
    userId: string,
    /** `banner` additionally enforces the minimum size — see below. */
    role: 'avatar' | 'banner' = 'avatar',
  ): Promise<string | null> {
    if (mediaId === null || mediaId === undefined || mediaId === '') return null;

    const upload = await db.mediaUpload.findFirst({
      where: { id: mediaId, uploaderId: userId },
      select: { id: true, width: true, height: true },
    });
    if (upload === null) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'That image is not one of yours.');
    }

    /*
     * ★ A MINIMUM, NOT AN EXACT SIZE ★
     *
     * The banner renders at 600 × 120 and the renderer crops to fill, so an upload of any larger
     * proportion fits correctly without being re-encoded — no second image pipeline, and no
     * quality lost re-compressing something the hardener already processed.
     *
     * What CANNOT be fixed by cropping is an image too small to fill the space: scaling up produces
     * a blurred mess, and the member blames us rather than their source file. So the only rule is a
     * floor, and it is stated with both numbers because a refusal nobody can act on is worse than
     * no refusal.
     */
    if (role === 'banner' && (upload.width < BANNER.minUploadWidth || upload.height < BANNER.minUploadHeight)) {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        `A banner needs to be at least ${BANNER.minUploadWidth} × ${BANNER.minUploadHeight} pixels so it stays sharp at ${BANNER.width} × ${BANNER.height}. Yours is ${upload.width} × ${upload.height}.`,
      );
    }

    return upload.id;
  }
}

/**
 * A stored row as the client sees it.
 *
 * `discordAvatarUrl` is the fallback the caller already holds; passing it in keeps this function
 * free of a second query per member and keeps "the default is your Discord picture" a fact about
 * rendering rather than something stored and able to go stale.
 */
export function toView(
  row: {
    avatarMediaId: string | null;
    bannerSpec: unknown;
    tagline: string | null;
    bannerMediaId: string | null;
    bannerUrl: string | null;
    bannerLabel: string | null;
    accent: string;
    showRank: boolean;
    showCommander: boolean;
    enabled: boolean;
  } | null,
  discordAvatarUrl: string | null,
): SignatureView {
  if (row === null) {
    return {
      avatarUrl: discordAvatarUrl,
      bannerSpec: null,
      tagline: null,
      bannerUrl: null,
      bannerLink: null,
      bannerLabel: null,
      accent: 'orange',
      showRank: true,
      showCommander: true,
      enabled: true,
    };
  }

  return {
    /*
     * OUR path, built from the media id — never a stored URL. Same rule as post images: there is
     * no field in which a foreign host could be written, so `img-src 'self'` holds by construction
     * rather than by remembering to check.
     */
    avatarUrl: row.avatarMediaId === null ? discordAvatarUrl : `/v1/media/uploads/${row.avatarMediaId}`,
    /*
     * Re-validated on the way OUT as well as in. A row can predate a change to the spec shape, and
     * a renderer meeting a field it does not understand would draw something nobody designed.
     * Anything unreadable becomes null, which renders as no banner rather than a broken one.
     */
    bannerSpec: safeSpec(row.bannerSpec),
    tagline: row.tagline,
    bannerUrl: row.bannerMediaId === null ? null : `/v1/media/uploads/${row.bannerMediaId}`,
    bannerLink: row.bannerUrl,
    bannerLabel: row.bannerLabel,
    accent: (SIGNATURE_ACCENTS as readonly string[]).includes(row.accent)
      ? (row.accent as SignatureAccent)
      : // A stored value outside the set means the set shrank under it. Fall back rather than
        // render an unknown class name, which would produce an unstyled block.
        'orange',
    showRank: row.showRank,
    showCommander: row.showCommander,
    enabled: row.enabled,
  };
}

/** Trims, length-checks, and turns empty into null. */
function clean(value: string | null | undefined, max: number, field: string): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (trimmed.length > max) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, `${field} has to be ${max} characters or less.`);
  }
  /*
   * Stored as PLAIN TEXT and escaped at render. No sanitiser, because there is no markup to
   * sanitise — a tagline is one line under a name, and the moment it accepts formatting it becomes
   * another place member markup reaches a page.
   */
  return trimmed;
}

/** A stored spec, or null when it is from a shape we no longer understand. */
function safeSpec(raw: unknown): BannerSpec | null {
  if (raw === null || raw === undefined) return null;
  try {
    return validateBannerSpec(raw);
  } catch {
    return null;
  }
}

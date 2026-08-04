import { describe, it, expect } from 'vitest';
import {
  announce,
  memberVerifiedContent,
  mentionOf,
  monthYearLabel,
  promotionLine,
  promotionOrders,
  type PrismaClient,
} from './index.js';

/**
 * The announcement templates are APPROVED COPY — the owner signed off these exact words, so the
 * tests pin them character for character. A refactor that "improves" the wording is a regression
 * here, on purpose: changing what the squadron is told is a decision, not a cleanup.
 */

describe('mentionOf — who an announcement names', () => {
  it('MANDATORY: a linked member is a mention token, wrapped bold', () => {
    expect(mentionOf({ displayName: 'Grim', discordId: '1262447044337864850' })).toBe(
      '**<@1262447044337864850>**',
    );
  });

  it('a member without a Discord identity gets their display name un-tagged', () => {
    // A mention token for an id Discord does not know renders as literal <@…> noise.
    expect(mentionOf({ displayName: 'Grim', discordId: null })).toBe('**Grim**');
    expect(mentionOf({ displayName: 'Grim', discordId: '' })).toBe('**Grim**');
  });
});

describe('promotionLine — one member of the orders', () => {
  it('MANDATORY: the approved line, verbatim', () => {
    expect(promotionLine({ displayName: 'Grim', discordId: '123456789012345678' }, 'Sergeant')).toBe(
      '**<@123456789012345678>** — promoted to **Sergeant**.',
    );
  });

  it('falls back to the display name when no Discord identity is linked', () => {
    expect(promotionLine({ displayName: 'Grim', discordId: null }, 'Sergeant')).toBe(
      '**Grim** — promoted to **Sergeant**.',
    );
  });

  it('the plain rendering uses the display name even when a Discord id exists — forum readers are not Discord', () => {
    expect(
      promotionLine({ displayName: 'Grim', discordId: '123456789012345678' }, 'Sergeant', {
        plain: true,
      }),
    ).toBe('**Grim** — promoted to **Sergeant**.');
  });
});

describe('promotionOrders — one announcement per run, never one per member', () => {
  const promoted = [
    { person: { displayName: 'Grim', discordId: '111111111111111111' }, rank: 'Sergeant' },
    { person: { displayName: 'Reaper', discordId: null }, rank: 'Corporal' },
  ];

  it('MANDATORY: the approved copy with one line per member, mentions interpolated', () => {
    const { content } = promotionOrders('August 2026', promoted);
    expect(content).toBe(
      [
        '🎖️ **PROMOTION ORDERS — August 2026**',
        '',
        'The squadron recognises its own. Step forward:',
        '',
        '**<@111111111111111111>** — promoted to **Sergeant**.',
        '**Reaper** — promoted to **Corporal**.',
        '',
        'Congratulations, commanders. The rank was never given — it was earned. o7',
      ].join('\n'),
    );
  });

  it('MANDATORY: the forum copy carries display names and no raw mention tokens', () => {
    const { forum } = promotionOrders('August 2026', promoted);
    expect(forum.title).toBe('Promotion orders — August 2026');
    expect(forum.body).toContain('**Grim** — promoted to **Sergeant**.');
    expect(forum.body).not.toContain('<@');
  });
});

describe('memberVerifiedContent — the welcome, verbatim', () => {
  it('MANDATORY: the approved copy with the mention interpolated', () => {
    expect(memberVerifiedContent({ displayName: 'Grim', discordId: '222222222222222222' })).toBe(
      [
        '🫡 **A new commander joins the squadron**',
        '',
        '**<@222222222222222222>** just completed verification — Inara confirms them as one of ours.',
        '',
        'Welcome aboard, CMDR. Wing up, check the boards, and fly dangerous. o7',
      ].join('\n'),
    );
  });

  it('names the member plainly when no Discord identity is linked', () => {
    expect(memberVerifiedContent({ displayName: 'Grim', discordId: null })).toContain(
      '**Grim** just completed verification',
    );
  });
});

describe('monthYearLabel — the orders are dated in UTC', () => {
  it('renders the month the rollups are keyed on, not the local one', () => {
    // 23:30 UTC on 31 July is still July everywhere that matters to the rollups.
    expect(monthYearLabel(new Date(Date.UTC(2026, 6, 31, 23, 30)))).toBe('July 2026');
    expect(monthYearLabel(new Date(Date.UTC(2026, 7, 1)))).toBe('August 2026');
  });
});

describe('announce — failure never propagates', () => {
  it('MANDATORY: a database refusal returns false rather than throwing', async () => {
    const db = {
      $executeRaw: () => Promise.reject(new Error('down')),
    } as unknown as PrismaClient;

    await expect(
      announce(db, { kind: 'deploy', content: 'x' }),
    ).resolves.toBe(false);
  });

  it('reports success when the row lands, forum half included', async () => {
    const seen: unknown[][] = [];
    const db = {
      $executeRaw: (...args: unknown[]) => {
        seen.push(args);
        return Promise.resolve(1);
      },
    } as unknown as PrismaClient;

    await expect(
      announce(db, { kind: 'promotion', content: 'orders', forum: { title: 't', body: 'b' } }),
    ).resolves.toBe(true);
    expect(seen).toHaveLength(1);
  });
});

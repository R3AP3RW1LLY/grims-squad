import type { HubCall } from './hub-colony.js';

/**
 * The Help & Support console, read from the hub.
 *
 * ★ THE ANSWERING SIDE, IN THE APP ★
 *
 * The website's officers' console, mirrored — the same full-parity rule colonisation set. An
 * officer at their desk with the game running should not need a browser to tell a guest how to
 * join. Same shapes the website's console reads, off the companion's own device-token door, so
 * the two surfaces cannot disagree about what is waiting.
 *
 * Only members holding SUPPORT_AGENT get anything from these calls; `supportAccess` is how the
 * sidebar finds that out without an error in anybody's log.
 */

export interface SupportRequesterMember {
  readonly kind: 'member';
  readonly id: string;
  readonly displayName: string;
  /**
   * The member's Discord avatar as a `data:` URI, or null when they have none stored.
   *
   * ★ A DATA URI, BECAUSE THE RENDERER'S CSP IS `img-src 'self' data:` ★
   *
   * The window deliberately loads no remote content, and widening its policy to one hub URL
   * would have to name an origin that differs between dev and production. So the MAIN process
   * fetches `/v1/media/avatars/<id>` — the same route both websites draw — inlines the bytes,
   * and caches them per member, and the page renders what it is handed. The identity requirement
   * is the owner's: the officer must see exactly which member each conversation belongs to.
   */
  readonly avatar: string | null;
}

export interface SupportRequesterGuest {
  readonly kind: 'guest';
  readonly name: string;
}

export interface SupportConversationRow {
  readonly id: string;
  readonly status: 'open' | 'closed';
  readonly subject: string | null;
  readonly requester: SupportRequesterMember | SupportRequesterGuest;
  readonly preview: string;
  readonly createdAt: string;
  readonly lastMessageAt: string;
  /** Whether words landed since ANY officer last opened it — the console is one shared queue. */
  readonly unread: boolean;
}

export interface SupportMessage {
  readonly id: string;
  readonly authorKind: 'member' | 'officer' | 'guest' | 'ai' | 'system';
  /** Officer or member. `avatar` is a data URI for the same CSP reason as the requester's. */
  readonly author: {
    readonly id: string;
    readonly displayName: string;
    readonly avatar: string | null;
  } | null;
  readonly body: string;
  /** A path on the hub — the app prefixes the API base URL to draw it. */
  readonly attachmentPath: string | null;
  readonly createdAt: string;
}

export interface SupportTranscript {
  readonly conversation: SupportConversationRow;
  readonly messages: SupportMessage[];
}

/* The shapes as the HUB sends them — before the avatar bytes are inlined here. */
type WireAuthor = { readonly id: string; readonly displayName: string };
type WireRequester = Omit<SupportRequesterMember, 'avatar'> | SupportRequesterGuest;
type WireRow = Omit<SupportConversationRow, 'requester'> & { readonly requester: WireRequester };
type WireMessage = Omit<SupportMessage, 'author'> & { readonly author: WireAuthor | null };
type WireTranscript = { readonly conversation: WireRow; readonly messages: WireMessage[] };

type Answer<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * Avatars, cached per member in the main process.
 *
 * Ten minutes, because the console re-reads every thirty seconds and a picture that changes
 * once a month must not be re-downloaded sixty times an hour for every row on the queue. A 404
 * is cached too — "no avatar" is the common case for a fresh account, and asking again every
 * poll would hammer the one answer that never changes mid-session. A network failure keeps
 * whatever was cached rather than recording a miss, so one blip does not blank every face for
 * ten minutes.
 */
const AVATAR_TTL_MS = 10 * 60_000;
const avatarCache = new Map<string, { uri: string | null; at: number }>();

async function avatarDataUri(call: HubCall, userId: string): Promise<string | null> {
  const hit = avatarCache.get(userId);
  const now = Date.now();
  if (hit !== undefined && now - hit.at < AVATAR_TTL_MS) return hit.uri;

  const doFetch = call.fetchImpl ?? fetch;
  const ac = new AbortController();
  // Its own, shorter timeout: a face is decoration, and a hung avatar must not stall a queue.
  const timer = setTimeout(() => ac.abort(), 5_000);

  try {
    const res = await doFetch(
      `${call.apiBaseUrl.replace(/\/+$/, '')}/v1/media/avatars/${encodeURIComponent(userId)}`,
      { signal: ac.signal },
    );
    if (!res.ok) {
      avatarCache.set(userId, { uri: null, at: now });
      return null;
    }
    const type = res.headers.get('content-type') ?? 'image/png';
    const uri = `data:${type};base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}`;
    avatarCache.set(userId, { uri, at: now });
    return uri;
  } catch {
    return hit?.uri ?? null;
  } finally {
    clearTimeout(timer);
  }
}

/** One resolved avatar per DISTINCT member, however many rows they appear on. */
async function avatarsFor(call: HubCall, ids: readonly string[]): Promise<Map<string, string | null>> {
  const unique = [...new Set(ids)];
  const uris = await Promise.all(unique.map((id) => avatarDataUri(call, id)));
  return new Map(unique.map((id, i) => [id, uris[i] ?? null]));
}

function dressRequester(
  requester: WireRequester,
  avatars: Map<string, string | null>,
): SupportRequesterMember | SupportRequesterGuest {
  return requester.kind === 'member'
    ? { ...requester, avatar: avatars.get(requester.id) ?? null }
    : requester;
}

/**
 * One request to the companion's support surface. Same failure-becomes-a-sentence contract as
 * `hubColony`, and the same reasons — including the 403 distinction: "not paired" is fixed by
 * pairing, "not allowed" is fixed by an officer granting SUPPORT_AGENT, and telling a member to
 * re-pair for the second sends them round a loop that cannot help.
 */
async function hubSupport<T>(
  call: HubCall,
  path: string,
  init?: { method: 'POST' | 'PATCH'; body?: unknown },
): Promise<Answer<T>> {
  if (call.deviceToken === '') return { ok: false, error: 'Pair this device first.' };

  const doFetch = call.fetchImpl ?? fetch;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), call.timeoutMs ?? 15_000);

  try {
    const res = await doFetch(
      `${call.apiBaseUrl.replace(/\/+$/, '')}/v1/companion/support${path}`,
      {
        method: init?.method ?? 'GET',
        headers: {
          authorization: `Bearer ${call.deviceToken}`,
          // The header follows the BODY, never the method — Fastify refuses a declared JSON
          // body that does not arrive. Same rule as hubColony.
          ...(init?.body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(init?.body === undefined ? {} : { body: JSON.stringify(init.body) }),
        signal: ac.signal,
      },
    );

    if (res.status === 401) return { ok: false, error: 'This device is no longer paired.' };
    if (res.status === 403) {
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      return {
        ok: false,
        error: body?.error?.message ?? 'Your rank does not have access to the support console.',
      };
    }

    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      return { ok: false, error: body?.error?.message ?? `The hub answered ${res.status}.` };
    }

    const data = (await res.json().catch(() => null)) as T | null;
    if (data === null) return { ok: false, error: 'The hub sent something we could not read.' };
    return { ok: true, data };
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError';
    return {
      ok: false,
      error: aborted
        ? 'The hub did not answer in time.'
        : 'Could not reach the hub. Check your connection.',
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Whether the paired member may work the console at all. The sidebar entry reads this. */
export const supportAccess = (call: HubCall): Promise<Answer<{ agent: boolean }>> =>
  hubSupport<{ agent: boolean }>(call, '/access');

export const supportBadge = (call: HubCall): Promise<Answer<{ waiting: number }>> =>
  hubSupport<{ waiting: number }>(call, '/badge');

export async function supportConversations(
  call: HubCall,
  status: 'open' | 'closed',
): Promise<Answer<{ conversations: SupportConversationRow[] }>> {
  const wire = await hubSupport<{ conversations: WireRow[] }>(
    call,
    `/conversations?status=${status}`,
  );
  if (!wire.ok) return wire;

  const avatars = await avatarsFor(
    call,
    wire.data.conversations.flatMap((r) => (r.requester.kind === 'member' ? [r.requester.id] : [])),
  );
  return {
    ok: true,
    data: {
      conversations: wire.data.conversations.map((r) => ({
        ...r,
        requester: dressRequester(r.requester, avatars),
      })),
    },
  };
}

export async function supportConversation(
  call: HubCall,
  id: string,
): Promise<Answer<SupportTranscript>> {
  const wire = await hubSupport<WireTranscript>(call, `/conversations/${encodeURIComponent(id)}`);
  if (!wire.ok) return wire;

  const { conversation, messages } = wire.data;
  const avatars = await avatarsFor(call, [
    ...(conversation.requester.kind === 'member' ? [conversation.requester.id] : []),
    ...messages.flatMap((m) => (m.author === null ? [] : [m.author.id])),
  ]);

  return {
    ok: true,
    data: {
      conversation: { ...conversation, requester: dressRequester(conversation.requester, avatars) },
      messages: messages.map((m) => ({
        ...m,
        author:
          m.author === null ? null : { ...m.author, avatar: avatars.get(m.author.id) ?? null },
      })),
    },
  };
}

export const supportReply = (
  call: HubCall,
  id: string,
  body: string,
): Promise<Answer<{ message: SupportMessage }>> =>
  hubSupport<{ message: SupportMessage }>(call, `/conversations/${encodeURIComponent(id)}/messages`, {
    method: 'POST',
    body: { body },
  });

export const supportClose = (call: HubCall, id: string): Promise<Answer<{ ok: boolean }>> =>
  hubSupport<{ ok: boolean }>(call, `/conversations/${encodeURIComponent(id)}/close`, {
    method: 'PATCH',
  });

export const supportReopen = (call: HubCall, id: string): Promise<Answer<{ ok: boolean }>> =>
  hubSupport<{ ok: boolean }>(call, `/conversations/${encodeURIComponent(id)}/reopen`, {
    method: 'PATCH',
  });

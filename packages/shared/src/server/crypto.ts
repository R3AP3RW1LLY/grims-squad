import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Envelope encryption for OAuth refresh tokens, cAPI tokens and device tokens.
 *
 * @INV-012 — encrypted at rest with AES-256-GCM, key from the secret store,
 * never present in logs, errors, audit rows or API responses.
 *
 * Envelope format:  v1.<keyId>.<iv>.<ciphertext>.<tag>     (all base64url)
 *
 * Two design points are load-bearing:
 *
 * 1. CONTEXT BINDING. The caller-supplied context string is passed as AES-GCM
 *    additional authenticated data. It is authenticated but not stored, so a
 *    ciphertext minted for `discord.refresh:<userA>` cannot be opened under
 *    `discord.refresh:<userB>`. Encryption alone would leave the ciphertext
 *    portable: anyone able to write a row could paste an officer's encrypted
 *    token into their own and the server would refresh as the officer. AAD
 *    turns that row-copy into a decryption failure.
 *
 * 2. KEY IDS. The active key encrypts; any key in the ring can decrypt. Rotation
 *    is therefore additive and does not invalidate every stored token at the
 *    moment of rollout, which is what makes rotation something we will actually
 *    do rather than something we intend to.
 */

const VERSION = 'v1';
const IV_BYTES = 12; // 96-bit nonce, the GCM standard
const TAG_BYTES = 16;
const KEY_BYTES = 32; // AES-256

/** Carries no key material and no plaintext, by construction. */
export class EncryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EncryptionError';
  }
}

export interface EncryptionKeyring {
  readonly activeKeyId: string;
  keyFor(keyId: string): Buffer | undefined;
}

const KEY_ID_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/i;

/**
 * Builds a keyring from `id:base64key[,id:base64key...]`. The FIRST entry is
 * active. Every failure mode below throws rather than degrading, because the
 * degraded state is "tokens stored in plaintext" and that must never be
 * reachable by accident.
 */
export function createKeyring(spec: string): EncryptionKeyring {
  if (typeof spec !== 'string' || spec.trim() === '') {
    throw new EncryptionError('Encryption keyring is empty. Refusing to start unencrypted.');
  }

  const keys = new Map<string, Buffer>();
  let active: string | undefined;

  for (const entry of spec.split(',')) {
    const trimmed = entry.trim();
    if (trimmed === '') continue;

    const sep = trimmed.indexOf(':');
    if (sep <= 0 || sep === trimmed.length - 1) {
      throw new EncryptionError('Malformed keyring entry. Expected "<keyId>:<base64Key>".');
    }

    const keyId = trimmed.slice(0, sep);
    const b64 = trimmed.slice(sep + 1);
    if (!KEY_ID_RE.test(keyId)) {
      throw new EncryptionError('Malformed key id in keyring.');
    }
    if (keys.has(keyId)) {
      throw new EncryptionError(`Duplicate key id "${keyId}" — rotation order would be ambiguous.`);
    }

    // Node's base64 decoder is permissive: it silently drops invalid characters
    // rather than failing, so a typo'd key would yield a SHORT buffer instead of
    // an error. Re-encoding and comparing is what actually catches that.
    let key: Buffer;
    try {
      key = Buffer.from(b64, 'base64');
    } catch {
      throw new EncryptionError('Key is not valid base64.');
    }
    if (key.toString('base64').replace(/=+$/, '') !== b64.replace(/=+$/, '')) {
      throw new EncryptionError('Key is not valid base64.');
    }
    if (key.length !== KEY_BYTES) {
      throw new EncryptionError(
        `Key must be exactly ${KEY_BYTES} bytes (got ${key.length}). Generate with: openssl rand -base64 32`,
      );
    }
    if (key.every((b) => b === 0)) {
      // An all-zero key is what an unset or half-configured env var produces.
      throw new EncryptionError('Key is all zero bytes. This is an unset environment variable.');
    }

    keys.set(keyId, key);
    active ??= keyId;
  }

  if (active === undefined) {
    throw new EncryptionError('Encryption keyring contains no usable key.');
  }

  // Narrowing does not survive into the closure below, so bind it here.
  const activeKeyId: string = active;

  // Keys live in a closure, never as an own property, so no amount of
  // JSON.stringify, util.inspect or accidental logging can surface them.
  const ring: EncryptionKeyring = {
    activeKeyId,
    keyFor: (id) => keys.get(id),
  };
  Object.defineProperty(ring, 'toJSON', { value: () => '[EncryptionKeyring]', enumerable: false });
  Object.defineProperty(ring, Symbol.for('nodejs.util.inspect.custom'), {
    value: () => '[EncryptionKeyring]',
    enumerable: false,
  });
  Object.defineProperty(ring, 'toString', { value: () => '[EncryptionKeyring]' });
  return Object.freeze(ring);
}

const b64u = (b: Buffer) => b.toString('base64url');

export class TokenCipher {
  #ring: EncryptionKeyring;

  constructor(ring: EncryptionKeyring) {
    this.#ring = ring;
    Object.defineProperty(this, 'toJSON', { value: () => '[TokenCipher]', enumerable: false });
    Object.defineProperty(this, Symbol.for('nodejs.util.inspect.custom'), {
      value: () => '[TokenCipher]',
      enumerable: false,
    });
  }

  toString(): string {
    return '[TokenCipher]';
  }

  /**
   * @param context binds the ciphertext to a purpose and subject, e.g.
   *        `discord.refresh:<userId>`. Required — an empty context would make
   *        every ciphertext portable between rows.
   */
  encrypt(plaintext: string, context: string): string {
    if (typeof context !== 'string' || context.trim() === '') {
      throw new EncryptionError('A non-empty context is required; it binds the ciphertext.');
    }
    const keyId = this.#ring.activeKeyId;
    const key = this.#ring.keyFor(keyId);
    if (key === undefined) throw new EncryptionError('Active key missing from keyring.');

    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
    cipher.setAAD(Buffer.from(context, 'utf8'));
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return [VERSION, keyId, b64u(iv), b64u(ct), b64u(cipher.getAuthTag())].join('.');
  }

  decrypt(envelope: string, context: string): string {
    if (typeof envelope !== 'string') throw new EncryptionError('Envelope is not a string.');
    const parts = envelope.split('.');
    if (parts.length !== 5) throw new EncryptionError('Malformed envelope.');

    const [version, keyId, ivB64, ctB64, tagB64] = parts as [
      string,
      string,
      string,
      string,
      string,
    ];
    if (version !== VERSION) {
      // Fail closed. A future version means a format we do not understand, and
      // guessing at it is how padding-oracle-shaped bugs are born.
      throw new EncryptionError(`Unsupported envelope version.`);
    }

    const key = this.#ring.keyFor(keyId);
    if (key === undefined) {
      throw new EncryptionError('Ciphertext was sealed with a key that is not in the keyring.');
    }

    const iv = Buffer.from(ivB64, 'base64url');
    const tag = Buffer.from(tagB64, 'base64url');
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
      throw new EncryptionError('Malformed envelope.');
    }

    try {
      const d = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
      d.setAAD(Buffer.from(context ?? '', 'utf8'));
      d.setAuthTag(tag);
      return Buffer.concat([d.update(Buffer.from(ctB64, 'base64url')), d.final()]).toString('utf8');
    } catch {
      // Deliberately opaque and identical for every failure mode: wrong key,
      // wrong context and tampered ciphertext are indistinguishable to a caller.
      // Node's own message is dropped so no plaintext fragment can ride along.
      throw new EncryptionError('Decryption failed: the token is invalid or was not sealed for it.');
    }
  }
}

/** Constant-time compare for secrets of equal expected length. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

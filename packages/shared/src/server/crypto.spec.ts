import { describe, it, expect } from 'vitest';
import { inspect } from 'node:util';
import { createKeyring, TokenCipher, EncryptionError } from './crypto.js';

/**
 * P1.1 — envelope encryption for OAuth / cAPI / device tokens.
 *
 * @INV-012 OAuth refresh tokens, cAPI tokens and device tokens are encrypted at
 * rest (AES-256-GCM, key from the secret store) and never appear in logs, error
 * messages, audit rows or API responses.
 *
 * The non-obvious property tested here is CONTEXT BINDING. Encrypting the token
 * is not enough on its own: if the ciphertext is portable, anyone with write
 * access to the row can copy an officer's encrypted refresh token into their own
 * `discord_identities` row and the server will happily decrypt it and refresh as
 * the officer. The context string is passed as AES-GCM additional authenticated
 * data, so a ciphertext minted for `discord.refresh:<userA>` fails to open under
 * `discord.refresh:<userB>`. That turns a row-copy into an auth failure.
 */

const KEY_A = Buffer.alloc(32, 7).toString('base64');
const KEY_B = Buffer.alloc(32, 9).toString('base64');

const ring = () => createKeyring(`k1:${KEY_A}`);
const SECRET = 'dQw4w9WgXcQ-refresh-token-value';
const CTX = 'discord.refresh:018f3c1e-0000-7000-8000-000000000001';

describe('TokenCipher @INV-012', () => {
  it('round-trips a token under a matching context', () => {
    const c = new TokenCipher(ring());
    expect(c.decrypt(c.encrypt(SECRET, CTX), CTX)).toBe(SECRET);
  });

  it('never leaves the plaintext recoverable from the envelope', () => {
    const c = new TokenCipher(ring());
    const env = c.encrypt(SECRET, CTX);
    expect(env).not.toContain(SECRET);
    // Nor in any decoded segment — a base64 layer is not encryption.
    const decoded = env
      .split('.')
      .map((p) => Buffer.from(p, 'base64url').toString('latin1'))
      .join('|');
    expect(decoded).not.toContain(SECRET);
    expect(decoded).not.toContain('refresh-token-value');
  });

  it('uses a fresh IV per call, so the same token never yields the same envelope', () => {
    const c = new TokenCipher(ring());
    const seen = new Set(Array.from({ length: 200 }, () => c.encrypt(SECRET, CTX)));
    expect(seen.size).toBe(200);
  });

  it('REFUSES a ciphertext minted for a different subject (context binding)', () => {
    const c = new TokenCipher(ring());
    const stolen = c.encrypt(SECRET, 'discord.refresh:user-A');
    // Attacker copies the officer's encrypted column value into their own row.
    expect(() => c.decrypt(stolen, 'discord.refresh:user-B')).toThrow(EncryptionError);
  });

  it('REFUSES a ciphertext moved between purposes', () => {
    const c = new TokenCipher(ring());
    const env = c.encrypt(SECRET, 'discord.refresh:u1');
    expect(() => c.decrypt(env, 'capi.refresh:u1')).toThrow(EncryptionError);
  });

  it('detects tampering with the ciphertext body', () => {
    const c = new TokenCipher(ring());
    const parts = c.encrypt(SECRET, CTX).split('.');
    const ct = Buffer.from(parts[3] as string, 'base64url');
    ct[0] = (ct[0] as number) ^ 0xff;
    parts[3] = ct.toString('base64url');
    expect(() => c.decrypt(parts.join('.'), CTX)).toThrow(EncryptionError);
  });

  it('detects a stripped or forged auth tag', () => {
    const c = new TokenCipher(ring());
    const parts = c.encrypt(SECRET, CTX).split('.');
    parts[4] = Buffer.alloc(16).toString('base64url');
    expect(() => c.decrypt(parts.join('.'), CTX)).toThrow(EncryptionError);
  });

  it('fails closed on an unknown envelope version rather than guessing', () => {
    const c = new TokenCipher(ring());
    const env = c.encrypt(SECRET, CTX).replace(/^v1\./, 'v2.');
    expect(() => c.decrypt(env, CTX)).toThrow(EncryptionError);
  });

  it('fails closed on a malformed envelope', () => {
    const c = new TokenCipher(ring());
    for (const bad of ['', 'garbage', 'v1.k1', 'v1.k1.a.b', '....']) {
      expect(() => c.decrypt(bad, CTX)).toThrow(EncryptionError);
    }
  });

  // ---------------------------------------------------------------- rotation
  it('decrypts under a retired key while encrypting under the active one', () => {
    // Rotation must not invalidate every stored token at the moment of rollout.
    const rotated = createKeyring(`k2:${KEY_B},k1:${KEY_A}`);
    const old = new TokenCipher(ring()).encrypt(SECRET, CTX);
    const c = new TokenCipher(rotated);
    expect(c.decrypt(old, CTX)).toBe(SECRET);
    expect(c.encrypt(SECRET, CTX).startsWith('v1.k2.')).toBe(true);
  });

  it('refuses a ciphertext whose key id is not in the keyring', () => {
    const c = new TokenCipher(createKeyring(`k2:${KEY_B}`));
    const old = new TokenCipher(ring()).encrypt(SECRET, CTX);
    expect(() => c.decrypt(old, CTX)).toThrow(EncryptionError);
  });

  // ------------------------------------------------------------ no leakage
  it('never puts key material or plaintext in an error message', () => {
    const c = new TokenCipher(ring());
    const stolen = c.encrypt(SECRET, 'discord.refresh:user-A');
    try {
      c.decrypt(stolen, 'discord.refresh:user-B');
      expect.unreachable('should have thrown');
    } catch (e) {
      const dump = `${(e as Error).message} ${(e as Error).stack ?? ''}`;
      expect(dump).not.toContain(SECRET);
      expect(dump).not.toContain(KEY_A);
      expect(dump).not.toContain(Buffer.from(KEY_A, 'base64').toString('latin1'));
    }
  });

  it('never reveals key material through logging, inspection or serialisation', () => {
    const kr = ring();
    const c = new TokenCipher(kr);
    const raw = Buffer.from(KEY_A, 'base64').toString('latin1');
    for (const dump of [
      JSON.stringify(kr),
      JSON.stringify(c),
      String(kr),
      String(c),
      // pino serialises via util.inspect for non-JSON values.
      inspect(c, { depth: 10 }),
      inspect(kr, { depth: 10 }),
    ]) {
      expect(dump ?? '').not.toContain(KEY_A);
      expect(dump ?? '').not.toContain(raw);
    }
  });

  // ------------------------------------------------------------ key hygiene
  it('rejects a key that is not exactly 32 bytes', () => {
    expect(() => createKeyring(`k1:${Buffer.alloc(16, 1).toString('base64')}`)).toThrow(
      EncryptionError,
    );
    expect(() => createKeyring(`k1:${Buffer.alloc(31, 1).toString('base64')}`)).toThrow(
      EncryptionError,
    );
  });

  it('rejects an empty or malformed keyring spec instead of running unencrypted', () => {
    for (const bad of ['', '   ', 'nokey', 'k1:', ':abcd', 'k1:not-base64!!']) {
      expect(() => createKeyring(bad)).toThrow(EncryptionError);
    }
  });

  it('rejects an all-zero key, which is the classic unset-env-var mistake', () => {
    expect(() => createKeyring(`k1:${Buffer.alloc(32, 0).toString('base64')}`)).toThrow(
      EncryptionError,
    );
  });

  it('rejects duplicate key ids, which would make rotation ambiguous', () => {
    expect(() => createKeyring(`k1:${KEY_A},k1:${KEY_B}`)).toThrow(EncryptionError);
  });

  it('refuses to encrypt with an empty context, which would disable binding', () => {
    const c = new TokenCipher(ring());
    expect(() => c.encrypt(SECRET, '')).toThrow(EncryptionError);
  });
});

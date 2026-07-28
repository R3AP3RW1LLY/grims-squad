/**
 * Somewhere to put files (D5, D22).
 *
 * ★ AN INTERFACE, BECAUSE THE ANSWER DIFFERS BY ENVIRONMENT ★
 *
 * Production writes to Vultr's S3-compatible object storage. A developer's
 * laptop has no bucket and should not need one to see an avatar render, so it
 * writes to a folder. Same interface, so nothing above this line knows or cares
 * which is in play.
 *
 * ★ WE SERVE IT, THE BUCKET DOES NOT ★
 *
 * Objects are read back through our own API rather than linked to directly, and
 * that is deliberate rather than lazy:
 *
 *  - It works whether the bucket is public or private, so nothing has to be
 *    provisioned a second time to make avatars visible.
 *  - A public bucket URL leaks its own structure. Anyone holding one avatar URL
 *    can guess the shape of the rest, and object storage has no ACL granularity
 *    worth relying on for that.
 *  - It keeps the storage provider swappable. Every avatar URL in every cached
 *    page would otherwise name the vendor.
 */

export interface StoredObject {
  readonly body: Uint8Array;
  readonly contentType: string;
}

export interface ObjectStore {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
}

export interface S3Config {
  readonly endpoint: string;
  readonly region: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
}

/**
 * Reads the S3 settings, or reports that they are absent.
 *
 * Absent is a legitimate state — a developer running the API locally has no
 * bucket — so this returns null rather than throwing. A HALF-configured bucket
 * is not legitimate and does throw, because the failure otherwise arrives much
 * later as a signature error nobody can trace back to a missing variable.
 */
export function s3ConfigFrom(env: NodeJS.ProcessEnv): S3Config | null {
  const keys = ['S3_ENDPOINT', 'S3_REGION', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'];
  const values = keys.map((k) => env[k]?.trim() ?? '');
  /*
   * CONTAINS, not startsWith. .env.example ships
   * `S3_ENDPOINT=https://CHANGE_ME.vultrobjects.com` — the placeholder is in the
   * middle. Matching only the start would read that one line as configured, the
   * other four as missing, and throw "partly configured" at anybody who copied
   * the example file without editing it.
   */
  const isPlaceholder = (v: string) => v === '' || v.includes('CHANGE_ME');
  const set = values.filter((v) => !isPlaceholder(v));

  if (set.length === 0) return null;
  if (set.length !== keys.length) {
    const missing = keys.filter((_, i) => isPlaceholder(values[i] ?? ''));
    throw new Error(
      `Object storage is partly configured. Missing or placeholder: ${missing.join(', ')}. ` +
        `Set all of them, or none of them to use local disk.`,
    );
  }

  return {
    endpoint: values[0] as string,
    region: values[1] as string,
    bucket: values[2] as string,
    accessKeyId: values[3] as string,
    secretAccessKey: values[4] as string,
  };
}

import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import type { ObjectStore, StoredObject, S3Config } from './object-store.js';

/**
 * Vultr object storage, or anything else speaking S3.
 *
 * ★ WHY THE SDK RATHER THAN SIGNING IT OURSELVES ★
 *
 * SigV4 is about seventy lines and entirely feasible to write. It is also the
 * kind of code where a subtle mistake — header ordering, an unhashed payload,
 * a trailing slash — produces a signature that is wrong only sometimes, and the
 * failure surfaces in production as a 403 with no useful detail.
 *
 * The dependency is large and this is a server, where that costs nothing that
 * matters. Correctness here is worth more than the megabyte.
 */
export class S3ObjectStore implements ObjectStore {
  readonly #client: S3Client;
  readonly #bucket: string;

  constructor(config: S3Config) {
    this.#bucket = config.bucket;
    this.#client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      // Vultr, MinIO and most non-AWS implementations address buckets by PATH
      // (endpoint/bucket/key) rather than by subdomain. Without this the SDK
      // asks for bucket.endpoint, which does not resolve.
      forcePathStyle: true,
    });
  }

  async put(key: string, body: Uint8Array, contentType: string): Promise<void> {
    await this.#client.send(
      new PutObjectCommand({
        Bucket: this.#bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        /*
         * No public-read ACL, deliberately. Objects are read back through our
         * own API, so the bucket never needs to be world-readable — and a
         * bucket that is not world-readable cannot be enumerated by somebody
         * who guessed one key.
         */
      }),
    );
  }

  async get(key: string): Promise<StoredObject | null> {
    try {
      const res = await this.#client.send(
        new GetObjectCommand({ Bucket: this.#bucket, Key: key }),
      );
      const body = await res.Body?.transformToByteArray();
      if (body === undefined) return null;
      return { body, contentType: res.ContentType ?? 'application/octet-stream' };
    } catch (error) {
      // A missing object is a normal answer, not a failure: a member who has
      // never had an avatar has no object, and the caller renders a fallback.
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await this.#client.send(new DeleteObjectCommand({ Bucket: this.#bucket, Key: key }));
  }
}

function isNotFound(error: unknown): boolean {
  const name = (error as { name?: string; Code?: string } | null)?.name;
  const code = (error as { Code?: string } | null)?.Code;
  return name === 'NoSuchKey' || name === 'NotFound' || code === 'NoSuchKey';
}

/**
 * A folder on disk, for development.
 *
 * Exists so that running the API locally needs no bucket, no credentials and no
 * account. An avatar that only renders once somebody has provisioned object
 * storage is an avatar nobody sees while building the page it goes on.
 */
export class FileObjectStore implements ObjectStore {
  readonly #root: string;

  constructor(root: string) {
    this.#root = resolve(root);
  }

  async put(key: string, body: Uint8Array, contentType: string): Promise<void> {
    const path = this.#pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
    // Alongside rather than in the name, so the key round-trips unchanged.
    await writeFile(`${path}.type`, contentType, 'utf8');
  }

  async get(key: string): Promise<StoredObject | null> {
    const path = this.#pathFor(key);
    try {
      const [body, contentType] = await Promise.all([
        readFile(path),
        readFile(`${path}.type`, 'utf8').catch(() => 'application/octet-stream'),
      ]);
      return { body, contentType: contentType.trim() };
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    const path = this.#pathFor(key);
    await rm(path, { force: true });
    await rm(`${path}.type`, { force: true });
  }

  /**
   * Resolves a key to a path INSIDE the root, and refuses anything else.
   *
   * ★ PATH TRAVERSAL ★
   *
   * Keys are ours today, but this class takes a string and writes a file with
   * it. A key of `../../etc/something` would escape the root, and the check
   * costs one comparison. The equivalent mistake in the S3 driver is harmless;
   * here it is arbitrary file write.
   */
  #pathFor(key: string): string {
    const path = resolve(join(this.#root, key));
    if (path !== this.#root && !path.startsWith(this.#root + sep)) {
      throw new Error('Object key escapes the storage root.');
    }
    return path;
  }
}

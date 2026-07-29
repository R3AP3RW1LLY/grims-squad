import {
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import type { Readable } from 'node:stream';
import type { S3Config } from '../media/object-store.js';
import type { ReleaseBucket } from './release.service.js';

/**
 * The release bucket, over S3.
 *
 * ★ SEPARATE FROM `ObjectStore`, AND ON PURPose ★
 *
 * `ObjectStore` reads whole objects into memory — right for a 40 kB avatar,
 * catastrophic for a 100 MB installer with forty members clicking at once after
 * a Discord announcement. This one lists and STREAMS, and does nothing else.
 */
export class S3ReleaseBucket implements ReleaseBucket {
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
      // rather than by subdomain. Without this the SDK asks for
      // bucket.endpoint, which does not resolve.
      forcePathStyle: true,
    });
  }

  async listPrefix(prefix: string) {
    const res = await this.#client.send(
      new ListObjectsV2Command({ Bucket: this.#bucket, Prefix: prefix }),
    );

    return (res.Contents ?? []).flatMap((o) =>
      o.Key === undefined
        ? []
        : [
            {
              key: o.Key,
              sizeBytes: o.Size ?? 0,
              // A missing timestamp sorts last rather than crashing the page.
              modifiedAt: o.LastModified ?? new Date(0),
            },
          ],
    );
  }

  async openObject(key: string) {
    try {
      const res = await this.#client.send(
        new GetObjectCommand({ Bucket: this.#bucket, Key: key }),
      );

      /*
       * The body as a STREAM. `transformToByteArray` — which the avatar store
       * uses — would buffer a hundred megabytes per concurrent download, and a
       * squadron announcement is exactly when that happens simultaneously.
       */
      const body = res.Body as Readable | undefined;
      if (body === undefined) return null;

      return { stream: body, sizeBytes: res.ContentLength ?? 0 };
    } catch (error) {
      // A missing object is a normal answer: nothing has been released yet, or
      // CI pruned this version. The caller renders "not available".
      const name = (error as { name?: string } | null)?.name;
      if (name === 'NoSuchKey' || name === 'NotFound') return null;
      throw error;
    }
  }
}

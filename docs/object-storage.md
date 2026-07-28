# Object storage

Two buckets on one Vultr subscription (`grims-squad-backups`, Silicon Valley,
`sjc1.vultrobjects.com`). Buckets are free within a subscription; a second
subscription would be **+$6/mo** and buys only credential separation, which is
not the boundary that matters here.

| Bucket | Holds | Written by |
|---|---|---|
| `grims-squad-vault` | Database dumps and backups | The backup runbook |
| `grims-squad-media` | Everything the website serves | The API, and CI |

**They are separate on purpose.** A release prune, a retention policy or a
mistaken `rm --recursive` in one must not be able to reach the other. Backups
are the thing you need precisely when something else has gone wrong.

## Layout inside `grims-squad-media`

Everything is namespaced by a prefix. The bucket is shared across features, so
a prefix is what stops one feature's cleanup touching another's objects.

```
avatars/{userId}/{hash}.img     Discord avatars, cached at our own size
companion/{installer}           The companion app. ONE version at a time.
forums/…                        (P2) attachments and uploads
```

### Rules

**Every feature gets a prefix, and every sweep is scoped to its own.** The
companion release job lists and deletes under `companion/` only — that is what
makes it safe to run against a bucket holding avatars and, later, forum
attachments.

**Nothing is world-readable.** The bucket has no public-read ACL. Objects are
served back through our own API, which means the download is members-only and a
bucket that cannot be enumerated by somebody who guessed one key.

**The API needs exactly five variables**, and `s3ConfigFrom` throws if some are
set and others are not — a typo in one is loud rather than a silent fallback to
local disk in production:

```
S3_ENDPOINT=https://sjc1.vultrobjects.com
S3_REGION=us-east-1
S3_BUCKET=grims-squad-media
S3_ACCESS_KEY_ID=…
S3_SECRET_ACCESS_KEY=…
```

The same five are GitHub repository secrets, used by the companion release
workflow.

## A note on the tier

The subscription is Vultr's **Archival** tier — "ultra low-cost storage for
infrequently accessed data", 800 ops/sec and 600 MB/sec. Right for backups, and
fine for downloads at this size: egress is ~$0.01/GB, so a 95 MB installer to a
hundred members is about **ten pence**.

If the forums ever serve a lot of hot images, revisit the tier rather than the
architecture — the prefixes and the API-mediated reads do not change.

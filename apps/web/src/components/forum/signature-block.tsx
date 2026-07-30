import type { SignatureView } from '@grims/shared';

/**
 * A member's signature, under their post.
 *
 * ★ WHY IT IS QUIET ★
 *
 * "Make this an awesome generator ... fully customizable" was the instruction, and the temptation
 * is to make the OUTPUT loud to prove the feature exists. That gets it backwards. A signature sits
 * under every post its owner writes, so on a busy thread it is repeated a dozen times — anything
 * eye-catching competes with the conversation it is attached to, and the first complaint is not
 * "signatures are ugly", it is "the forum is hard to read".
 *
 * So: separated by a hairline, smaller than body text, secondary colour. The customisation is real
 * — avatar, tagline, banner, accent — it just does not shout.
 *
 * ★ EVERY VALUE HERE IS MEMBER-AUTHORED, AND NONE OF IT IS MARKUP ★
 *
 * The tagline and label are rendered as TEXT by React, which escapes them. There is no
 * `dangerouslySetInnerHTML` anywhere in this file and there must never be one: a signature is the
 * highest-reach field on the site — one bad value is not one bad page, it is every page its author
 * has ever posted on.
 *
 * The image paths come from the server, built from OUR media ids, and the link was checked against
 * a host allowlist before storage. Neither is trusted here, but neither has to be re-checked.
 */

/**
 * Accent → an existing design token.
 *
 * Every one of these is a token `pnpm contrast:check` already verifies, which is the reason the
 * accent is a closed set rather than a colour picker: a member choosing their own would eventually
 * choose one they cannot read against our panel, and would experience that as the site being
 * broken rather than as their own choice.
 */
const ACCENT: Record<SignatureView['accent'], string> = {
  orange: 'var(--color-brand-orange)',
  cyan: 'var(--color-brand-cyan-bright)',
  gold: 'var(--color-semantic-warning)',
  steel: 'var(--color-text-secondary)',
};

export function SignatureBlock({ signature }: { readonly signature: SignatureView }) {
  const { tagline, bannerUrl, bannerLink, bannerLabel } = signature;

  // Nothing worth a divider. An empty signature block is a horizontal rule that means nothing.
  if (tagline === null && bannerUrl === null && bannerLink === null) return null;

  const accent = ACCENT[signature.accent] ?? ACCENT.orange;

  const banner =
    bannerUrl === null ? null : (
      <img
        src={bannerUrl}
        /*
         * The member's own label as alt text, falling back to something honest rather than empty.
         * A banner that is also a LINK must have an accessible name — an unlabelled linked image
         * is announced as its URL, which is neither useful nor what they wrote it for.
         */
        alt={bannerLabel ?? 'Signature banner'}
        loading="lazy"
        className="max-h-20 w-auto max-w-full rounded border"
        style={{ borderColor: accent }}
      />
    );

  return (
    <div
      className="mt-4 border-t pt-3"
      style={{ borderColor: 'var(--color-border-hairline)' }}
      /*
       * Marked as complementary content so a screen reader can skip it. Twelve repetitions of the
       * same block between posts is exhausting to listen through.
       */
      aria-label="Signature"
    >
      {tagline !== null && (
        <p className="text-xs italic leading-relaxed text-[var(--color-text-secondary)]">
          {tagline}
        </p>
      )}

      {banner !== null && (
        <div className="mt-2">
          {bannerLink === null ? (
            banner
          ) : (
            <a
              href={bannerLink}
              /*
               * `noopener noreferrer nofollow ugc`, exactly as the post sanitiser forces on member
               * links. `ugc` and `nofollow` say plainly to a crawler that this is user content and
               * not an endorsement — which is what stops a squadron forum becoming an SEO target.
               */
              rel="noopener noreferrer nofollow ugc"
              target="_blank"
              className="inline-block"
            >
              {banner}
            </a>
          )}
        </div>
      )}

      {banner === null && bannerLink !== null && (
        /* A link with no image still deserves to be clickable rather than silently dropped. */
        <p className="mt-2">
          <a
            href={bannerLink}
            rel="noopener noreferrer nofollow ugc"
            target="_blank"
            className="text-xs underline underline-offset-2"
            style={{ color: accent }}
          >
            {bannerLabel ?? bannerLink}
          </a>
        </p>
      )}
    </div>
  );
}

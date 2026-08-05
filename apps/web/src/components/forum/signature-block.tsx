import type { SignatureView } from '@grims/shared';
import { BANNER } from '@grims/shared/forum-signature';
import { BannerRender, EMPTY_IDENTITY, type BannerIdentity } from './banner-render';

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

export function SignatureBlock({
  signature,
  who,
}: {
  readonly signature: SignatureView;
  /**
   * Whose banner this is, for text layers that name a SOURCE rather than fixed words.
   *
   * Optional because most callers have no reason to know — a signature with no built banner does
   * not need it, and defaulting keeps every existing call site working.
   */
  readonly who?: BannerIdentity;
}) {
  const { tagline, bannerUrl, bannerLink, bannerLabel, bannerSpec } = signature;

  // Nothing worth a divider. An empty signature block is a horizontal rule that means nothing.
  if (tagline === null && bannerUrl === null && bannerLink === null && bannerSpec === null) {
    return null;
  }

  const accent = ACCENT[signature.accent] ?? ACCENT.orange;

  /*
   * A BUILT banner wins over an uploaded one.
   *
   * Both columns can hold a value — somebody uploads an image, then builds one instead, and the
   * old upload is still referenced. Preferring the spec means the thing they last worked on is the
   * thing that shows, rather than whichever branch happened to be checked first.
   */
  const banner =
    bannerSpec !== null ? (
      <BannerRender
        spec={bannerSpec}
        who={who ?? EMPTY_IDENTITY}
        width={BANNER.width}
        className="max-w-full"
        {...(bannerSpec.imageMediaId === undefined
          ? {}
          : { imageHref: `/v1/media/uploads/${bannerSpec.imageMediaId}` })}
      />
    ) : bannerUrl === null ? null : (
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
      /*
       * ★ ROOM TO BREATHE ★
       *
       * Squadron owner, 2026-07-30: the finished product "looks sloppy and thrown together".
       *
       * It was a hairline and 12px of padding wrapped around a 600px banner, so the banner ran to
       * the edges of a block that had no edges of its own — which reads as something that fell out
       * of the post rather than something placed under it. A panel with real padding, its own
       * surface and a rounded corner makes it a deliberate object.
       */
      className="mt-6 overflow-hidden rounded-lg border p-4"
      style={{
        borderColor: 'var(--color-border-hairline)',
        background: 'var(--color-surface-panel-sunken)',
      }}
      /*
       * Marked as complementary content so a screen reader can skip it. Twelve repetitions of the
       * same block between posts is exhausting to listen through.
       */
      aria-label="Signature"
    >
      {/* Column, so the banner leads and the tagline follows it whatever order they appear in. */}
      <div className="flex flex-col">
      {tagline !== null && (
        /*
         * Below the banner, not above it. The banner is the thing; a caption over the top of it
         * reads as a heading for the post rather than as a note from its author.
         */
        <p className="order-last mt-3 text-xs italic leading-relaxed text-[var(--color-text-secondary)]">
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
    </div>
  );
}

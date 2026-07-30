import { Mark, Node, mergeAttributes } from '@tiptap/core';

/**
 * Our two custom block nodes.
 *
 * ★ WHY NOT TIPTAP'S OWN IMAGE AND IFRAME EXTENSIONS ★
 *
 * `@tiptap/extension-image` stores a `src` — an arbitrary URL. That is exactly the field this
 * project spent a week ensuring cannot exist: a document that can hold a foreign address is a
 * document that can leak every reader's IP to a third-party host, and no amount of checking at
 * render time is as good as having nowhere to put one.
 *
 * So `squadronImage` stores a `mediaId` and NO url. The path is built at render time from our own
 * prefix. There is no attribute in which a foreign host could be written.
 *
 * Likewise there is no iframe node. `squadronVideo` stores an 11-character video id, and the
 * player is only ever created by a reader's click — see the renderer.
 */

export interface SquadronImageAttrs {
  mediaId: string;
  alt: string;
  align: 'left' | 'center' | 'right';
  widthPercent: number;
  caption: string;
}

/**
 * An uploaded image, with placement.
 *
 * `atom: true` — the node has no editable children. Its alt text, caption, alignment and width are
 * edited through the toolbar rather than by typing inside it, which keeps the selection model
 * simple and means a caret can never end up somewhere that produces an invalid document.
 */
export const SquadronImage = Node.create({
  name: 'squadronImage',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      // No default: an image without an id is dropped at conversion rather than saved broken.
      mediaId: { default: '' },
      alt: { default: '' },
      align: { default: 'center' },
      widthPercent: { default: 100 },
      caption: { default: '' },
    };
  },

  /*
   * ★ NO parseHTML, ON PURPOSE ★
   *
   * Without it, pasting `<img src="https://evil.test/x.png">` produces NOTHING rather than an
   * image node with a foreign src. Pasted images have to be uploaded through our own pipeline,
   * which is the only way they get hardened (EXIF stripped, polyglots killed) and the only way
   * they end up on our storage.
   *
   * The cost is that copy-pasting an image from a web page does not work. That is the correct
   * trade: it would otherwise hotlink somebody else's server and report our readers to them.
   */
  renderHTML({ HTMLAttributes }) {
    const attrs = HTMLAttributes as unknown as SquadronImageAttrs;
    return [
      'figure',
      mergeAttributes({
        'data-squadron-image': attrs.mediaId,
        class: `doc-figure doc-${attrs.align ?? 'center'}`,
        style: `width:${attrs.widthPercent ?? 100}%`,
      }),
      ['img', { src: `/v1/media/uploads/${attrs.mediaId}`, alt: attrs.alt ?? '' }],
    ];
  },
});

/**
 * A YouTube video, stored as an id.
 *
 * The editor shows a placeholder, not a player. Two reasons: an embedded iframe inside a
 * contenteditable steals focus and clicks in ways that are genuinely painful to work around, and —
 * the real one — loading it would report the AUTHOR to Google every time they opened the editor,
 * which is the same privacy problem click-to-play exists to solve for readers.
 */
export const SquadronVideo = Node.create({
  name: 'squadronVideo',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      videoId: { default: '' },
      title: { default: '' },
    };
  },

  renderHTML({ HTMLAttributes }) {
    const attrs = HTMLAttributes as unknown as { videoId: string; title: string };
    return [
      'div',
      mergeAttributes({ 'data-squadron-video': attrs.videoId, class: 'doc-embed doc-embed-editing' }),
      ['span', { class: 'doc-embed-title' }, attrs.title === '' ? 'YouTube video' : attrs.title],
    ];
  },
});

/**
 * A mention of another member.
 *
 * ★ A MARK, NOT A NODE, AND THAT IS THE FORMAT'S DECISION ★
 *
 * `rich-document.ts` models `mention` as a mark carrying a `userId`, so this matches it. The
 * practical difference: a mention is TEXT that happens to be tagged, so it wraps, selects, copies
 * and deletes like the words around it. An atom node would be an indivisible block in the middle
 * of a sentence, which is why mention chips in other editors need arrow-key special cases.
 *
 * ★ THE ID IS RESOLVED ONCE, WHEN THE AUTHOR PICKS SOMEBODY ★
 *
 * Not by scanning stored text for `@something` at render time. That approach breaks every past
 * mention when a member renames, is ambiguous forever between similar display names, and runs on
 * every read of every post. The display text is stored alongside the id, so a post still reads
 * correctly after the account is deleted.
 *
 * ★ NO parseHTML ★
 *
 * Same reasoning as the image node: pasting markup that looks like a mention must not produce one.
 * A mention is a claim that a specific member was addressed, and the only thing entitled to make
 * that claim is a pick from the autocomplete, which resolved a real id.
 */
export const Mention = Mark.create({
  name: 'mention',
  inclusive: false,

  addAttributes() {
    return {
      userId: { default: '' },
    };
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, { class: 'forum-mention', 'data-mention': '' }),
      0,
    ];
  },
});

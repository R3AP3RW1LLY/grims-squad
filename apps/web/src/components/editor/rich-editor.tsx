'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import type { RichDocument } from '@grims/shared';
import { FontFamily, Mention, SquadronImage, SquadronVideo } from './nodes';
import { FONT_CATEGORY_LABELS, FONT_FAMILIES, FONT_SITE_DEFAULT } from '@grims/shared/fonts';
import { MentionAutocomplete } from './mention-autocomplete';
import { toDocument, fromDocument, parseYouTubeId } from './doc-convert';

/**
 * The rich editor.
 *
 * Squadron owner, 2026-07-30: "create us a 100% custom text editor that matches the features of
 * word ... image attachments, placement editing, youtube video embedding, headers, text editing
 * the whole shebang!"
 *
 * ★ WHAT IS OURS AND WHAT IS NOT, STATED PLAINLY ★
 *
 * Every pixel of chrome, every toolbar control, the image placement UI, the upload flow, the
 * document format and the validation are ours. The selection/undo/IME/paste engine underneath is
 * ProseMirror via TipTap — which is the choice the owner approved, and the honest one: hand-rolling
 * selection ranges, undo history and mobile IME is thousands of lines whose bugs land in text
 * editing itself, and text editing is the one thing that must never feel wrong.
 *
 * ★ STYLING FOLLOWS THE SITE, WHICH IS NON-NEGOTIABLE ★
 *
 * No component library, no imported stylesheet, no new palette. Existing design tokens only, the
 * same hairline borders and panel surfaces as the rest of the hub.
 */

export interface RichEditorProps {
  /** Existing content, when editing. Omit for a new post. */
  readonly initial?: RichDocument;
  /** Called with the document, or null when there is nothing worth saving. */
  readonly onChange: (doc: RichDocument | null) => void;
  readonly placeholder?: string;
  readonly disabled?: boolean;
  /**
   * Content to append at the caret, when `nonce` changes.
   *
   * ★ A NONCE, NOT THE DOCUMENT ITSELF ★
   *
   * Quoting is an EVENT — "put this in my reply, now" — and events do not survive being modelled
   * as state. Watching the document for changes would re-insert the same quote on every unrelated
   * re-render; watching a counter fires exactly once per press, which is what the reader asked
   * for by clicking Quote.
   *
   * Append rather than replace, so quoting two posts in one reply works and nothing already typed
   * is destroyed.
   */
  readonly insert?: { nonce: number; doc: RichDocument };
  /**
   * Enables @mention autocomplete, scoped to a thread.
   *
   * Omitted where there is no thread yet — the new-thread composer. Candidates are filtered to
   * people who can READ the thread, and there is no thread to filter against until it exists.
   * Mentioning in an opening post would need a category-scoped answer, which is a different
   * question and not one anybody has asked for.
   */
  readonly mentionThreadId?: string;
  /**
   * Renders the content with no toolbar and no editing, for use as a live PREVIEW.
   *
   * ★ THE PREVIEW IS THIS SAME COMPONENT, NOT A SECOND RENDERER ★
   *
   * A composer preview is usually built by writing a second function that turns the document into
   * markup. That is a second renderer, and a second renderer disagrees with the first eventually —
   * so somebody writes a post that looks one way while composing and another once posted.
   *
   * Feeding the same TipTap schema the same document guarantees identical output, because it is
   * literally the same code path with the chrome hidden.
   */
  readonly preview?: boolean;
}

/** One toolbar button. Extracted because there are eleven of them and they must look identical. */
function ToolButton({
  label,
  active = false,
  disabled = false,
  onClick,
  children,
}: {
  readonly label: string;
  readonly active?: boolean;
  readonly disabled?: boolean;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      /*
       * `title` AND `aria-label`: the first gives a mouse user a tooltip, the second gives a screen
       * reader the name. A toolbar of unlabelled icons is unusable without sight, and this one is
       * open to every member.
       */
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      // `onMouseDown` with preventDefault, not onClick: clicking a toolbar button would otherwise
      // blur the editor and collapse the selection the command is about to act on.
      onMouseDown={(e) => {
        e.preventDefault();
        onClick();
      }}
      className={`rounded border px-2 py-1 text-xs transition-colors disabled:opacity-40 ${
        active
          ? 'border-[var(--color-border-active)] bg-[var(--color-surface-panel-hover)] text-[var(--color-text-primary)]'
          : 'border-[var(--color-border-hairline)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
      }`}
    >
      {children}
    </button>
  );
}

/** Reads the CSRF cookie. See the note in `image-uploader` — the name is `gs_csrf`, not `csrf`. */
function readCsrf(): string {
  for (const name of ['__Host-gs_csrf', 'gs_csrf']) {
    const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
    if (match?.[1] !== undefined) return decodeURIComponent(match[1]);
  }
  return '';
}

export function RichEditor({
  initial,
  onChange,
  placeholder,
  disabled = false,
  insert,
  mentionThreadId,
  preview = false,
}: RichEditorProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Our format models h2 and h3 only: the post title is the page's h1.
        heading: { levels: [2, 3] },
      }),
      Link.configure({
        openOnClick: false,
        autolink: false,
        /*
         * The schemes the server accepts. Configured here as well so a rejected link is refused
         * while typing rather than at save time — the server remains the authority, this is just
         * earlier feedback.
         */
        protocols: ['http', 'https', 'mailto'],
      }),
      Placeholder.configure({ placeholder: placeholder ?? 'Write something…' }),
      SquadronImage,
      SquadronVideo,
      Mention,
      FontFamily,
    ],
    /*
     * SPREAD, not `content: initial === undefined ? undefined : …`.
     *
     * `exactOptionalPropertyTypes` distinguishes "absent" from "present and undefined", and
     * TipTap's `content` is typed `Content` rather than `Content | undefined` — so passing
     * undefined explicitly is a type error while omitting the key is fine. The third time this
     * flag has caught the same reflex in this project, and it is right every time: an option
     * that is present-but-undefined is a different instruction from an absent one.
     */
    ...(initial === undefined ? {} : { content: fromDocument(initial) as never }),
    editable: !disabled && !preview,
    /*
     * Next.js renders this on the server first, and ProseMirror's output can differ from the
     * client's on the first pass. Without this React logs a hydration mismatch on every editor.
     */
    immediatelyRender: false,
    onUpdate: ({ editor: e }) => {
      onChange(toDocument(e.getJSON() as never));
    },
  });

  /*
   * Adopts a NEW `initial` when the parent supplies one — e.g. after loading an existing post.
   * `useEditor`'s `content` is only read once, so without this an editor mounted before its data
   * arrives stays empty forever. The same bug class as the verification-page snapshot.
   */
  const adopted = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (editor === null || initial === undefined) return;
    const key = JSON.stringify(initial);
    if (adopted.current === key) return;
    adopted.current = key;
    editor.commands.setContent(fromDocument(initial) as never);
  }, [editor, initial]);

  /*
   * Appends quoted content when the nonce moves. The first render is deliberately skipped: an
   * editor that mounts with a pending nonce would otherwise insert the quote before the member
   * asked, and "Reply" and "Quote" would become the same button.
   */
  const lastInsert = useRef<number | null>(insert?.nonce ?? null);
  useEffect(() => {
    if (editor === null || insert === undefined) return;
    // Seeded from whatever was present at MOUNT, so an editor that mounts with a nonce already
    // set does not insert it. A `null` seed means nothing was pending, and any nonce is new.
    if (lastInsert.current === insert.nonce) return;
    lastInsert.current = insert.nonce;
    editor
      .chain()
      .focus('end')
      .insertContent(fromDocument(insert.doc) as never)
      .run();
  }, [editor, insert]);

  const upload = useCallback(
    async (file: File) => {
      if (editor === null) return;
      setBusy(true);
      setError(null);
      try {
        const res = await fetch('/v1/media/uploads', {
          method: 'POST',
          body: file,
          headers: {
            'content-type': file.type === '' ? 'application/octet-stream' : file.type,
            'x-csrf-token': readCsrf(),
          },
          credentials: 'same-origin',
        });
        const json = (await res.json()) as
          | { id: string; width: number; height: number }
          | { error?: { message?: string } };

        if (!res.ok || !('id' in json)) {
          setError(
            'error' in json && typeof json.error?.message === 'string'
              ? json.error.message
              : 'That image could not be uploaded.',
          );
          return;
        }

        editor
          .chain()
          .focus()
          .insertContent({
            type: 'squadronImage',
            attrs: { mediaId: json.id, alt: '', align: 'center', widthPercent: 100, caption: '' },
          })
          .run();
      } catch {
        setError('Could not reach the server. Try again in a moment.');
      } finally {
        setBusy(false);
        // Cleared so re-picking the SAME file fires a change event again.
        if (fileInput.current !== null) fileInput.current.value = '';
      }
    },
    [editor],
  );

  if (editor === null) {
    // A stable box rather than nothing, so the form does not jump when the editor mounts.
    return (
      <div className="min-h-[220px] rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)]" />
    );
  }

  const imageSelected = editor.isActive('squadronImage');

  /*
   * PREVIEW MODE: the content, and nothing else. No border, no toolbar, no minimum height — it is
   * dropped inside post chrome that supplies all of those, and a bordered box inside a bordered
   * post reads as a quote rather than as the post body.
   */
  if (preview) {
    return <EditorContent editor={editor} className="guide-prose" />;
  }

  return (
    <div className="rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)]">
      <div
        role="toolbar"
        aria-label="Formatting"
        className="flex flex-wrap items-center gap-1 border-b border-[var(--color-border-hairline)] p-2"
      >
        <ToolButton label="Bold" active={editor.isActive('bold')} disabled={disabled} onClick={() => editor.chain().focus().toggleBold().run()}>
          <strong>B</strong>
        </ToolButton>
        <ToolButton label="Italic" active={editor.isActive('italic')} disabled={disabled} onClick={() => editor.chain().focus().toggleItalic().run()}>
          <em>I</em>
        </ToolButton>
        <ToolButton label="Strikethrough" active={editor.isActive('strike')} disabled={disabled} onClick={() => editor.chain().focus().toggleStrike().run()}>
          <span className="line-through">S</span>
        </ToolButton>
        <ToolButton label="Inline code" active={editor.isActive('code')} disabled={disabled} onClick={() => editor.chain().focus().toggleCode().run()}>
          <span className="font-mono">{'</>'}</span>
        </ToolButton>

        <span className="mx-1 h-5 w-px bg-[var(--color-border-hairline)]" aria-hidden="true" />

        <ToolButton label="Heading" active={editor.isActive('heading', { level: 2 })} disabled={disabled} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
          H2
        </ToolButton>
        <ToolButton label="Sub-heading" active={editor.isActive('heading', { level: 3 })} disabled={disabled} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>
          H3
        </ToolButton>
        <ToolButton label="Bulleted list" active={editor.isActive('bulletList')} disabled={disabled} onClick={() => editor.chain().focus().toggleBulletList().run()}>
          &bull;
        </ToolButton>
        <ToolButton label="Numbered list" active={editor.isActive('orderedList')} disabled={disabled} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
          1.
        </ToolButton>
        <ToolButton label="Quote" active={editor.isActive('blockquote')} disabled={disabled} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
          &ldquo;
        </ToolButton>
        <ToolButton label="Code block" active={editor.isActive('codeBlock')} disabled={disabled} onClick={() => editor.chain().focus().toggleCodeBlock().run()}>
          <span className="font-mono text-[10px]">{'{ }'}</span>
        </ToolButton>
        <ToolButton label="Divider" disabled={disabled} onClick={() => editor.chain().focus().setHorizontalRule().run()}>
          &mdash;
        </ToolButton>

        <span className="mx-1 h-5 w-px bg-[var(--color-border-hairline)]" aria-hidden="true" />

        <ToolButton
          label="Link"
          active={editor.isActive('link')}
          disabled={disabled}
          onClick={() => {
            if (editor.isActive('link')) {
              editor.chain().focus().unsetLink().run();
              return;
            }
            const href = window.prompt('Link to where? (http, https or mailto)');
            if (href === null || href.trim() === '') return;
            /*
             * Set on the current selection. TipTap refuses a scheme outside the configured list, so
             * a `javascript:` paste is rejected here as well as by the server.
             */
            editor.chain().focus().setLink({ href: href.trim() }).run();
          }}
        >
          Link
        </ToolButton>

        {/*
          The font picker. A `select` rather than a menu of styled buttons: thirty families is a
          list, and a native select gets keyboard search, scrolling and mobile handling for free.
        */}
        <select
          aria-label="Font"
          disabled={disabled}
          value={(editor.getAttributes('font')['font'] as string | undefined) ?? FONT_SITE_DEFAULT}
          onChange={(e) => {
            const id = e.target.value;
            /*
             * Applied to the SELECTION, or to whatever is typed next when nothing is selected —
             * which is how every other mark in this toolbar behaves, so the font should not be the
             * one control that needs text highlighted first.
             */
            if (id === FONT_SITE_DEFAULT) editor.chain().focus().unsetMark('font').run();
            else editor.chain().focus().setMark('font', { font: id }).run();
          }}
          className="rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel-sunken)] px-2 py-1 text-xs text-[var(--color-text-primary)] disabled:opacity-40"
        >
          <option value={FONT_SITE_DEFAULT}>Font</option>
          {(['display', 'sans', 'serif', 'mono', 'stencil'] as const).map((cat) => (
            <optgroup key={cat} label={FONT_CATEGORY_LABELS[cat]}>
              {FONT_FAMILIES.filter((f) => f.category === cat).map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>

        <ToolButton label="Insert image" disabled={disabled || busy} onClick={() => fileInput.current?.click()}>
          {busy ? 'Uploading…' : 'Image'}
        </ToolButton>

        <ToolButton
          label="Insert YouTube video"
          disabled={disabled}
          onClick={() => {
            const raw = window.prompt('Paste a YouTube link');
            if (raw === null) return;
            const videoId = parseYouTubeId(raw);
            if (videoId === null) {
              /*
               * Refused here rather than stored and rejected later. The parser checks the HOST
               * against a fixed list, so a link that merely contains "youtube.com" does not pass —
               * an embed is the one place an iframe is ever allowed to appear.
               */
              setError('That is not a YouTube link we recognise.');
              return;
            }
            setError(null);
            editor.chain().focus().insertContent({ type: 'squadronVideo', attrs: { videoId, title: '' } }).run();
          }}
        >
          Video
        </ToolButton>

        <span className="ml-auto flex items-center gap-1">
          <ToolButton label="Undo" disabled={disabled || !editor.can().undo()} onClick={() => editor.chain().focus().undo().run()}>
            &#8630;
          </ToolButton>
          <ToolButton label="Redo" disabled={disabled || !editor.can().redo()} onClick={() => editor.chain().focus().redo().run()}>
            &#8631;
          </ToolButton>
        </span>
      </div>

      {/*
        ★ THE IMAGE CONTROLS APPEAR ONLY WITH AN IMAGE SELECTED ★

        A second toolbar row that is always visible would be four dead controls most of the time.
        This is the "placement editing" the owner asked for: alignment, width, alt text and caption,
        all acting on the selected figure.
      */}
      {imageSelected && (
        <ImageControls editor={editor} disabled={disabled} />
      )}

      <input
        ref={fileInput}
        type="file"
        // A hint to the picker only — the server decides the real format by decoding the bytes.
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file !== undefined) void upload(file);
        }}
      />

      {error !== null && (
        <p role="alert" className="border-b border-[var(--color-border-hairline)] px-3 py-2 text-sm text-[var(--color-brand-orange-bright)]">
          {error}
        </p>
      )}

      {/*
        `guide-prose` so the editor renders content exactly as a reader will see it. Editing in one
        typeface and publishing in another is how layout surprises happen.
      */}
      <EditorContent
        editor={editor}
        className="guide-prose min-h-[220px] px-4 py-3 [&_.ProseMirror]:min-h-[200px] [&_.ProseMirror]:outline-none"
      />

      {/*
        Rendered only where a thread exists to scope the candidate list — see `mentionThreadId`.
        It returns null unless there is something to show, so it costs nothing when idle.
      */}
      {mentionThreadId !== undefined && (
        <MentionAutocomplete editor={editor} threadId={mentionThreadId} />
      )}
    </div>
  );
}

/** Alignment, width, alt text and caption for the selected image. */
function ImageControls({ editor, disabled }: { readonly editor: Editor; readonly disabled: boolean }) {
  const attrs = editor.getAttributes('squadronImage') as {
    align?: string;
    widthPercent?: number;
    alt?: string;
    caption?: string;
  };
  const set = (next: Record<string, unknown>) =>
    editor.chain().focus().updateAttributes('squadronImage', next).run();

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-[var(--color-border-hairline)] bg-[var(--color-surface-panel-sunken)] p-2">
      <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">
        Image
      </span>

      <span className="flex gap-1">
        {(['left', 'center', 'right'] as const).map((a) => (
          <ToolButton key={a} label={`Align ${a}`} active={attrs.align === a} disabled={disabled} onClick={() => set({ align: a })}>
            {a === 'left' ? '⇤' : a === 'center' ? '↔' : '⇥'}
          </ToolButton>
        ))}
      </span>

      <label className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
        Width
        <input
          type="range"
          /*
           * 25–100 matches the server's clamp. A pixel width would be wrong on a phone, which is
           * where every "my screenshot is cut off" report comes from.
           */
          min={25}
          max={100}
          step={5}
          value={attrs.widthPercent ?? 100}
          disabled={disabled}
          onChange={(e) => set({ widthPercent: Number(e.target.value) })}
          className="w-28"
        />
        <span className="w-10 font-mono text-[11px] text-[var(--color-text-primary)]">
          {attrs.widthPercent ?? 100}%
        </span>
      </label>

      <input
        type="text"
        value={attrs.alt ?? ''}
        disabled={disabled}
        onChange={(e) => set({ alt: e.target.value })}
        // Not optional framing: a screenshot with no description is invisible to some readers.
        placeholder="Describe the image"
        className="min-w-[14rem] flex-1 rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] px-2 py-1 text-xs text-[var(--color-text-primary)] placeholder:text-[var(--color-text-secondary)]"
      />

      <input
        type="text"
        value={attrs.caption ?? ''}
        disabled={disabled}
        onChange={(e) => set({ caption: e.target.value })}
        placeholder="Caption (shown under it)"
        className="min-w-[12rem] flex-1 rounded border border-[var(--color-border-hairline)] bg-[var(--color-surface-panel)] px-2 py-1 text-xs text-[var(--color-text-primary)] placeholder:text-[var(--color-text-secondary)]"
      />
    </div>
  );
}

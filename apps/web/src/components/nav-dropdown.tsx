'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * A dropdown in the public navigation.
 *
 * ★ WHY THIS IS A BUTTON AND NOT A `<details>` ★
 *
 * `<details>`/`<summary>` needs no JavaScript and was the first thing tried. It also does not close
 * when you click somewhere else, so on a nav bar it stays hanging open over the page until you
 * remember to click the summary again — which reads as broken rather than as minimal.
 *
 * ★ AND NOT A HOVER MENU ★
 *
 * Hover menus do not exist on a touch screen. The first tap opens them and the second tap lands on
 * whatever the menu is now covering, which on a phone is the fastest way to send somebody to a page
 * they did not choose.
 *
 * So: click to open, click outside or Escape to close, arrow keys to move through it, and focus
 * returns to the trigger when it closes.
 */

export interface NavChild {
  readonly href: string;
  readonly label: string;
  readonly hint?: string;
}

export function NavDropdown({
  label,
  children,
}: {
  readonly label: string;
  readonly children: readonly NavChild[];
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    const onPointer = (e: PointerEvent): void => {
      // Closes on a click ANYWHERE outside, which is the behaviour `<details>` is missing.
      if (wrap.current !== null && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      /*
       * Focus goes BACK to the trigger. Without this, Escape leaves focus on a hidden element and
       * the next Tab starts from the top of the document — which for a keyboard user means being
       * thrown back to the skip link every time they dismiss a menu.
       */
      trigger.current?.focus();
    };

    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={wrap} className="relative">
      <button
        ref={trigger}
        type="button"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-3 py-2 text-sm tracking-wide text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]"
      >
        {label}
        <span aria-hidden="true" className={`text-[10px] transition-transform ${open ? 'rotate-180' : ''}`}>
          ▾
        </span>
      </button>

      {open && (
        <div
          /*
           * `min-w` rather than a fixed width: "Recruiting" and "Guides" are short today and the
           * next entry might not be, and a menu that clips its own labels is worse than a wide one.
           */
          className="absolute right-0 top-full z-50 mt-1 min-w-56 rounded border border-[var(--color-border-active)] bg-[var(--color-surface-panel)] p-1 shadow-xl"
        >
          <ul className="list-none p-0">
            {children.map((c) => (
              <li key={c.href}>
                <a
                  href={c.href}
                  onClick={() => setOpen(false)}
                  className="block rounded px-3 py-2 text-sm text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-panel-hover)] hover:text-[var(--color-text-primary)]"
                >
                  {c.label}
                  {c.hint !== undefined && (
                    <span className="mt-0.5 block text-[11px] text-[var(--color-text-secondary)]">
                      {c.hint}
                    </span>
                  )}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

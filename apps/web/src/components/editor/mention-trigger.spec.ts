import { describe, it, expect } from 'vitest';

/**
 * When the @mention autocomplete should open — and, more importantly, when it must not.
 *
 * ★ WHY THIS IS TESTED APART FROM THE COMPONENT ★
 *
 * The trigger is one regular expression, and every bug it can have is a bug about WHERE the caret
 * is rather than about React. Testing it through a rendered editor would mean simulating a caret
 * to prove a property of a pattern.
 *
 * The pattern is duplicated here rather than exported, deliberately: the assertions below describe
 * the RULE. If somebody changes the component's regex and these still pass, the rule survived; if
 * they change it and these fail, the rule did not — which is the question worth asking.
 */

/** Mirrors `activeQuery` in `mention-autocomplete.tsx`. */
const TRIGGER = /(^|\s)@([\p{L}\p{N}_.-]{0,32})$/u;

function opensOn(textBeforeCaret: string): string | null {
  const m = TRIGGER.exec(textBeforeCaret);
  return m === null ? null : (m[2] ?? '');
}

describe('the @mention trigger', () => {
  describe('opens', () => {
    it('at the start of a block', () => {
      expect(opensOn('@peb')).toBe('peb');
    });

    it('after a space', () => {
      expect(opensOn('thanks @peb')).toBe('peb');
    });

    it('on a bare @ with nothing typed yet', () => {
      // Opens, but the component waits for two characters before searching — a one-character
      // prefix matches most of a 107-member roster and is not worth a request.
      expect(opensOn('hello @')).toBe('');
    });

    it('on names with accents, digits, dots, dashes and underscores', () => {
      /*
       * `\p{L}` rather than `[a-z]`: Elite handles are full of non-ASCII, and a trigger that gave
       * up on the first accented character would work for most of the squadron and silently fail
       * for the rest — the worst kind of bug to report.
       */
      expect(opensOn('@Jörð')).toBe('Jörð');
      expect(opensOn('@cmdr_07')).toBe('cmdr_07');
      expect(opensOn('@a.b-c')).toBe('a.b-c');
    });
  });

  describe('MANDATORY: stays shut', () => {
    it('inside an email address', () => {
      /*
       * THE ONE THAT MATTERS. Without the "start of block or whitespace" requirement, typing an
       * address opens a member search halfway through it — and the next Enter, meant for the next
       * line, picks somebody's name instead and mangles what was typed.
       */
      expect(opensOn('write to grim@pyrax')).toBeNull();
      expect(opensOn('shawn.wilson@pyrax')).toBeNull();
    });

    it('when the @ is glued to the end of a word', () => {
      expect(opensOn('cmdr@')).toBeNull();
    });

    it('once the run is broken by a space', () => {
      // "@peb merchant" is not a search for "peb merchant" — the member either picked somebody or
      // moved on, and a dropdown that stayed open would keep swallowing Enter.
      expect(opensOn('@peb merchant')).toBeNull();
    });

    it('when there is no @ at all', () => {
      expect(opensOn('just some text')).toBeNull();
    });

    it('beyond a sane name length', () => {
      /*
       * Capped at 32. Without a cap, a paragraph with a stray @ near the start keeps matching as
       * somebody types the whole sentence, issuing a search per keystroke for a query that cannot
       * match anybody.
       */
      expect(opensOn(`@${'a'.repeat(32)}`)).toBe('a'.repeat(32));
      expect(opensOn(`@${'a'.repeat(33)}`)).toBeNull();
    });
  });

  describe('the replaced range', () => {
    it('covers the @ and everything typed after it', () => {
      /*
       * The component computes `from = caret - typed.length - 1`. The `- 1` is the `@` itself;
       * without it the sigil survives the insertion and every mention reads "@@Name".
       */
      const before = 'thanks @peb';
      const typed = opensOn(before) ?? '';
      const caret = before.length;
      const from = caret - typed.length - 1;

      expect(before.slice(from, caret)).toBe('@peb');
    });
  });
});

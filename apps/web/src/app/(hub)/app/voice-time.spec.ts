import { describe, it, expect } from 'vitest';
import { voiceTime } from './voice-time';

/**
 * The voice-time formatter — the one place minutes become hours.
 *
 * Small on purpose: the failure it guards against is not complicated arithmetic but a call
 * site reinventing it, which is exactly how the old profile page turned a join COUNT into
 * "hours in voice".
 */
describe('voiceTime', () => {
  it('MANDATORY: renders zero as a dash, never as a figure', () => {
    // Zero is both "never spoke" and "before the banking shipped", and the table cannot tell
    // them apart — so it must not print a number that claims to.
    expect(voiceTime(0)).toBe('—');
  });

  it('renders under an hour as bare minutes', () => {
    expect(voiceTime(1)).toBe('1m');
    expect(voiceTime(45)).toBe('45m');
    expect(voiceTime(59)).toBe('59m');
  });

  it('renders an hour and up as `Xh Ym`', () => {
    expect(voiceTime(60)).toBe('1h 0m');
    expect(voiceTime(125)).toBe('2h 5m');
    expect(voiceTime(1441)).toBe('24h 1m');
  });

  it('treats a negative as nothing recorded rather than inventing time', () => {
    expect(voiceTime(-5)).toBe('—');
  });
});

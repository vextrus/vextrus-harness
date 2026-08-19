/**
 * Per-journey masks for the visual comparison (V-E2E: "per-journey masks for
 * volatile regions").
 *
 * A mask is a CSS selector whose matches are painted over before the baseline
 * compare, so a clock, an avatar or a generated id cannot turn a green journey
 * red at midnight. Keyed by journey id, because volatility is a property of the
 * screen a journey is on, not of the whole suite; an unmasked journey has an
 * empty entry rather than no entry, so adding a selector is an edit to a line
 * that already exists.
 *
 * Selectors that match nothing are not an error — a mask is a claim about what
 * *may* be volatile, and a screen that lost its clock did not break its journey.
 */
export const journeyMasks: Record<string, string[]> = {
  /** The scaffold home page is entirely static today. */
  'J-000': [],

  /** The self-test paints a live timestamp precisely so the mask has work to do. */
  'J-SELF': ['[data-testid="volatile-clock"]'],

  /** The axe breaker never reaches a baseline compare; it goes red first. */
  'J-SELF-AXE-FAIL': [],
};

/** The masks of `journeyId`, or none — an unknown journey masks nothing. */
export const masksFor = (journeyId: string): string[] => journeyMasks[journeyId] ?? [];

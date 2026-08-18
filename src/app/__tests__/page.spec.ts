/**
 * Acceptance for AC-08 (component level) — journey checkpoint `scaffold-home`.
 *
 * The served-over-HTTP half of AC-08 lives in tests/e2e/scaffold-home.e2e.spec.ts;
 * this segment keeps the assertion inside `pnpm verify`'s vitest stage, where it
 * costs milliseconds and cannot blow the Q-01 60 s budget.
 */
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import Page from '../page';

/** The root page may be a sync or async server component; both are acceptable. */
type RootPage = () => ReactElement | Promise<ReactElement>;

async function renderRoot(): Promise<string> {
  const element = await (Page as unknown as RootPage)();
  return renderToStaticMarkup(element);
}

describe('/ (root page)', () => {
  // AC-08: the title element carries the contract testid.
  it('renders a heading with data-testid="app-title"', async () => {
    const html = await renderRoot();
    expect(html).toMatch(/data-testid="app-title"/);
  });

  // AC-08: visible text is exactly "Vextrus".
  it('shows the visible text "Vextrus" inside that element', async () => {
    const html = await renderRoot();
    const match = /<([a-z0-9]+)[^>]*data-testid="app-title"[^>]*>([\s\S]*?)<\/\1>/.exec(html);
    expect(match).not.toBeNull();
    expect(match?.[2]?.replace(/<[^>]*>/g, '').trim()).toBe('Vextrus');
  });

  // Screens contract: a *heading*, not a bare div.
  it('uses a heading element for the title', async () => {
    const html = await renderRoot();
    expect(html).toMatch(/<h[1-6][^>]*data-testid="app-title"/);
  });
});

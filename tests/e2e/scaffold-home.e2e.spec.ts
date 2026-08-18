/**
 * Journey checkpoint `scaffold-home` — AC-08, served for real.
 *
 * Screens contract: `/` is a minimal titled page whose heading carries
 * data-testid="app-title" and reads "Vextrus", served by `pnpm dev` on 3210.
 */
import { describe, expect, it } from 'vitest';

import { withDevServer } from './helpers/proc';

describe('journey: scaffold-home', () => {
  // AC-08: GET / on the dev server's contract port.
  it('serves / on port 3210 with the app-title heading', async () => {
    await withDevServer(3210, async (baseUrl) => {
      const response = await fetch(baseUrl, { signal: AbortSignal.timeout(30_000) });
      expect(response.status).toBe(200);

      const html = await response.text();
      expect(html).toMatch(/data-testid="app-title"/);

      const match = /<(h[1-6])[^>]*data-testid="app-title"[^>]*>([\s\S]*?)<\/\1>/.exec(html);
      expect(match, 'app-title is not a heading element').not.toBeNull();
      expect(match?.[2]?.replace(/<[^>]*>/g, '').trim()).toBe('Vextrus');

      // "minimal titled page": the document has a non-empty <title>.
      const title = /<title[^>]*>([\s\S]*?)<\/title>/.exec(html);
      expect(title?.[1]?.trim().length ?? 0).toBeGreaterThan(0);
    });
  }, 180_000);
});

/**
 * Page object for the root screen `/` (Builder MAY edit).
 *
 * Screens: "/ — minimal titled page: heading \"Vextrus\" with
 * data-testid=\"app-title\"".
 */
import { DEV_ORIGIN } from '../support/dev-server';

export class HomePage {
  private html = '';

  async open(): Promise<this> {
    const response = await fetch(`${DEV_ORIGIN}/`, { redirect: 'follow' });
    if (!response.ok) throw new Error(`GET / responded ${String(response.status)}`);
    this.html = await response.text();
    return this;
  }

  document(): string {
    return this.html;
  }

  /** The element carrying data-testid="app-title", as served markup. */
  appTitleElement(): string | undefined {
    const match = /<([a-z][a-z0-9]*)\b[^>]*data-testid="app-title"[^>]*>([\s\S]*?)<\/\1>/i.exec(
      this.html,
    );
    return match?.[0];
  }

  appTitleText(): string | undefined {
    const element = this.appTitleElement();
    if (element === undefined) return undefined;
    const inner = /^<[^>]+>([\s\S]*)<\/[^>]+>$/.exec(element)?.[1] ?? '';
    return inner
      .replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
}

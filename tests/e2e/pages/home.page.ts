/**
 * Page object for the root screen `/` (Builder MAY edit).
 * Addresses the page only through the contracted testid, never through markup
 * details, so styling work in m0-08/m0-14 cannot break this journey.
 */
export class HomePage {
  constructor(
    private readonly html: string,
    readonly status: number,
  ) {}

  static async open(baseUrl: string): Promise<HomePage> {
    const response = await fetch(new URL('/', baseUrl));
    return new HomePage(await response.text(), response.status);
  }

  /** The element carrying `data-testid="app-title"`, if the page renders one. */
  private element(testid: string): { tag: string; text: string } | undefined {
    const pattern = new RegExp(
      `<([a-zA-Z][\\w-]*)([^>]*\\sdata-testid=["']${testid}["'][^>]*)>([\\s\\S]*?)</\\1>`,
    );
    const match = this.html.match(pattern);
    if (match === null) return undefined;
    const tag = match[1] ?? '';
    const inner = match[3] ?? '';
    return { tag, text: inner.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim() };
  }

  get appTitle(): { tag: string; text: string } | undefined {
    return this.element('app-title');
  }
}

/** Page object for the root screen `/`. Builder MAY edit selectors here. */
export class HomePage {
  static readonly path = '/';
  static readonly titleTestId = 'app-title';

  private html = '';

  constructor(private readonly baseUrl: string) {}

  async open(): Promise<number> {
    const response = await fetch(new URL(HomePage.path, this.baseUrl));
    this.html = await response.text();
    return response.status;
  }

  /** Visible text of the element carrying data-testid="app-title". */
  titleText(): string | null {
    const pattern = new RegExp(
      `<([a-z][\\w-]*)[^>]*data-testid=["']${HomePage.titleTestId}["'][^>]*>([\\s\\S]*?)</\\1>`,
      'i',
    );
    const match = pattern.exec(this.html);
    return match?.[2] ? match[2].replace(/<[^>]*>/g, '').trim() : null;
  }

  /** Tag name of the app-title element — the contract calls it a heading. */
  titleTag(): string | null {
    const pattern = new RegExp(
      `<([a-z][\\w-]*)[^>]*data-testid=["']${HomePage.titleTestId}["']`,
      'i',
    );
    return pattern.exec(this.html)?.[1]?.toLowerCase() ?? null;
  }

  body(): string {
    return this.html;
  }
}

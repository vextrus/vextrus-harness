/**
 * Page object for the root screen `/`.
 * Builder MAY edit this file when the markup shape changes — the assertions
 * that matter live in the journey segment, not here.
 */
export interface HomePage {
  html: string;
  /** Text of the element carrying data-testid="app-title", or undefined. */
  appTitle: () => string | undefined;
  /** Tag name of that element (e.g. "h1"), or undefined. */
  appTitleTag: () => string | undefined;
}

const TESTID = 'app-title';

function matchTestidElement(html: string): RegExpExecArray | null {
  const pattern = new RegExp(
    `<([a-zA-Z][a-zA-Z0-9]*)\\b[^>]*data-testid=["']${TESTID}["'][^>]*>([\\s\\S]*?)<\\/\\1>`,
  );
  return pattern.exec(html);
}

function stripTags(fragment: string): string {
  return fragment.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

export function homePage(html: string): HomePage {
  return {
    html,
    appTitle: () => {
      const found = matchTestidElement(html);
      const body = found?.[2];
      return body === undefined ? undefined : stripTags(body);
    },
    appTitleTag: () => matchTestidElement(html)?.[1]?.toLowerCase(),
  };
}

export async function openHome(baseUrl: string): Promise<HomePage> {
  const response = await fetch(new URL('/', baseUrl));
  if (!response.ok) throw new Error(`GET / responded ${String(response.status)}`);
  return homePage(await response.text());
}

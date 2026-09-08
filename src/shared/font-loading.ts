import type { DesignDocument } from './schema';

const localFonts = new Set(['arial', 'arial black', 'helvetica', 'helvetica neue', 'georgia', 'times', 'times new roman', 'courier', 'courier new', 'verdana', 'tahoma', 'trebuchet ms', 'calibri', 'cambria', 'segoe ui', 'apple color emoji', 'segoe ui emoji', 'blinkmacsystemfont', 'system-ui', 'ui-sans-serif', 'ui-serif', 'ui-monospace', 'sans-serif', 'serif', 'monospace', 'cursive', 'fantasy', 'inherit']);
export function googleFontFamily(value: string): string | null {
  const family = value.split(',')[0].trim().replace(/^['"]|['"]$/g, '');
  return /^[a-zA-Z][a-zA-Z0-9 -]{0,99}$/.test(family) && !localFonts.has(family.toLowerCase()) ? family : null;
}
export function documentFontFamilies(doc: DesignDocument): string[] {
  const values = [doc.theme.fonts.heading, doc.theme.fonts.body, ...doc.pages.flatMap(page => page.nodes.map(node => String(node.style?.fontFamily ?? '')))];
  return [...new Set(values.map(googleFontFamily).filter((value): value is string => !!value))].sort();
}
export function googleFontsStylesheetUrl(families: readonly string[]): string | null {
  const selected = [...new Set(families.map(googleFontFamily).filter((value): value is string => !!value))].sort();
  if (!selected.length) return null;
  // Request the default face: some Google families do not offer bold or italic axes.
  return `https://fonts.googleapis.com/css2?${selected.map(family => `family=${encodeURIComponent(family).replace(/%20/g, '+')}`).join('&')}&display=swap`;
}
const pendingStylesheets = new WeakMap<HTMLLinkElement, Promise<void>>();
const requestedStylesheets = new WeakMap<Document, string>();
async function waitForFontFaces(target: Document, families: string[]) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.all(families.map(family => target.fonts.load(`16px "${family}"`))),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Google Font files loading timed out.')), 10000); }),
    ]);
  } finally { clearTimeout(timer); }
}
export async function loadDocumentFonts(doc: DesignDocument, target: Document = document): Promise<void> {
  const families = documentFontFamilies(doc);
  const href = googleFontsStylesheetUrl(families);
  if (!href) return;
  if ([...target.querySelectorAll<HTMLStyleElement>('style[data-studio-fonts-embedded]')].some(style => style.getAttribute('data-studio-fonts-embedded') === href)) {
    await waitForFontFaces(target, families);
    return;
  }
  requestedStylesheets.set(target, href);
  let link = [...target.querySelectorAll<HTMLLinkElement>('link[data-studio-fonts]')].find(item => item.href === href);
  if (!link) {
    link = target.createElement('link'); link.rel = 'stylesheet'; link.href = href; link.dataset.studioFonts = '';
    const pending = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { link!.remove(); reject(new Error('Google Fonts loading timed out.')); }, 10000);
      link!.onload = () => { clearTimeout(timer); resolve(); };
      link!.onerror = () => { clearTimeout(timer); link!.remove(); reject(new Error('Google Fonts could not load.')); };
    });
    pendingStylesheets.set(link, pending);
    target.head.append(link);
  }
  await pendingStylesheets.get(link);
  if (requestedStylesheets.get(target) === href) [...target.querySelectorAll<HTMLLinkElement>('link[data-studio-fonts]')].filter(item => item !== link).forEach(item => item.remove());
  await waitForFontFaces(target, families);
}

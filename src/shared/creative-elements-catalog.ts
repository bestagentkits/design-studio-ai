/** Original Design Studio artwork, distributed under the repository MIT license.
 * No platform emoji fonts, external CDN, or third-party artwork is used. */
export const ELEMENT_ARTWORK_LICENSE = 'Original artwork © Design Studio AI contributors; MIT (repository LICENSE)';
export type LibraryElement = { id: string; name: string; keywords: string[]; kind: 'sticker' | 'emoji'; unicode?: string; recolorable: boolean; body: string };
export const ELEMENT_LIBRARY: LibraryElement[] = [
  { id: 'star', name: 'Celebration star', keywords: ['success', 'favorite', 'award'], kind: 'sticker', recolorable: true, body: '<path d="M64 8 80 44 120 48 90 76 98 116 64 96 30 116 38 76 8 48 48 44Z" fill="COLOR" stroke="#26352d" stroke-width="4"/>' },
  { id: 'heart', name: 'Love heart', keywords: ['love', 'care', 'like'], kind: 'sticker', recolorable: true, body: '<path d="M64 114C-20 64 16-12 64 34 112-12 148 64 64 114Z" fill="COLOR" stroke="#26352d" stroke-width="4"/>' },
  { id: 'sparkle', name: 'Sparkle', keywords: ['magic', 'shine', 'new'], kind: 'sticker', recolorable: true, body: '<path d="M64 4Q68 58 120 64 68 70 64 124 58 70 6 64 58 58 64 4Z" fill="COLOR"/>' },
  { id: 'leaf', name: 'Growing leaf', keywords: ['nature', 'green', 'plant'], kind: 'sticker', recolorable: true, body: '<path d="M20 108Q-8 20 110 12 130 116 20 108Z" fill="COLOR"/><path d="M14 116 92 34M42 88 40 54M64 66 96 68" fill="none" stroke="#26352d" stroke-width="5"/>' },
  { id: 'smile', name: 'Smiling face', keywords: ['happy', 'smile', '😀'], kind: 'emoji', unicode: '😀', recolorable: false, body: '<circle cx="64" cy="64" r="58" fill="#ffce54"/><circle cx="44" cy="48" r="6"/><circle cx="84" cy="48" r="6"/><path d="M32 70Q64 116 96 70Z" fill="#26352d"/><path d="M40 72H88" stroke="white" stroke-width="7"/>' },
  { id: 'wink', name: 'Winking face', keywords: ['wink', 'fun', '😉'], kind: 'emoji', unicode: '😉', recolorable: false, body: '<circle cx="64" cy="64" r="58" fill="#ffce54"/><circle cx="43" cy="48" r="6"/><path d="M76 49Q86 38 96 49M34 78Q64 106 94 78" fill="none" stroke="#26352d" stroke-width="6" stroke-linecap="round"/>' },
  { id: 'thumb', name: 'Thumbs up', keywords: ['approve', 'yes', 'good', '👍'], kind: 'emoji', unicode: '👍', recolorable: false, body: '<path d="M40 60 64 34 66 10Q91 6 84 52H108Q124 52 117 75L106 110H40Z" fill="SKIN" stroke="#26352d" stroke-width="4"/><rect x="12" y="58" width="28" height="54" rx="6" fill="#6699cc"/>' },
];
export const EMOJI_SKIN_VARIANTS = [{ name: 'Default', color: '#ffce54', suffix: '' }, { name: 'Light', color: '#f7dcc4', suffix: '🏻' }, { name: 'Medium light', color: '#ddb18b', suffix: '🏼' }, { name: 'Medium', color: '#b98055', suffix: '🏽' }, { name: 'Medium dark', color: '#895a38', suffix: '🏾' }, { name: 'Dark', color: '#55382c', suffix: '🏿' }];
export function searchElements(query: string): LibraryElement[] {
  const words = query.toLocaleLowerCase().trim().split(/\s+/);
  return ELEMENT_LIBRARY.filter(item => words.every(word => [item.name, ...item.keywords].join(' ').toLocaleLowerCase().includes(word)));
}
export function elementArtwork(item: LibraryElement, color = '#e6aa48', variant = 0): string {
  if (!ELEMENT_LIBRARY.includes(item) || !/^#[0-9a-f]{6}$/i.test(color) || !EMOJI_SKIN_VARIANTS[variant]) throw new Error('Invalid bundled artwork choice');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">${item.body.replaceAll('COLOR', color).replaceAll('SKIN', EMOJI_SKIN_VARIANTS[variant].color)}</svg>`;
}
export function artworkUrl(item: LibraryElement, color?: string, variant?: number): string { return `data:image/svg+xml,${encodeURIComponent(elementArtwork(item, color, variant))}`; }

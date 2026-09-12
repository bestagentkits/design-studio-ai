const siteName = 'Design Studio AI';
const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

export interface PublicMetadata {
  origin: string;
  path: string;
  title: string;
  description: string;
  type?: 'WebPage' | 'TechArticle' | 'Article' | 'CollectionPage' | 'ProfilePage' | 'ItemPage';
  indexable?: boolean;
  image?: string;
  imageAlt?: string;
  breadcrumbs?: { name: string; path: string }[];
}

/** Shared by static public pages and request-rendered Community pages. */
export function publicMetadata({ origin, path, title, description, type = 'WebPage', indexable = true, image, imageAlt, breadcrumbs }: PublicMetadata) {
  const absolute = (path: string) => new URL(path, origin).href;
  const url = absolute(path);
  const imageUrl = absolute(image || '/social-card.png');
  const alt = imageAlt || 'Design Studio AI — a design workspace for people and agents.';
  const meta = (key: string, value: string, property = false) => `<meta ${property ? 'property' : 'name'}="${key}" content="${escape(value)}">`;
  const article = type === 'Article' || type === 'TechArticle';
  const graph: Record<string, unknown>[] = [
    { '@type': 'WebSite', '@id': absolute('/#website'), name: siteName, url: absolute('/'), inLanguage: 'en' },
    { '@type': article ? 'WebPage' : type, '@id': `${url}#page`, name: title, description, url, inLanguage: 'en', isPartOf: { '@id': absolute('/#website') }, primaryImageOfPage: { '@type': 'ImageObject', url: imageUrl }, ...(breadcrumbs?.length ? { breadcrumb: { '@id': `${url}#breadcrumbs` } } : {}), ...(path === '/' ? { mainEntity: { '@id': absolute('/#application') } } : article ? { mainEntity: { '@id': `${url}#article` } } : {}) },
  ];
  if (article) graph.push({ '@type': type, '@id': `${url}#article`, headline: title, description, url, inLanguage: 'en', image: imageUrl, mainEntityOfPage: { '@id': `${url}#page` } });
  if (path === '/') graph.push({
    '@type': 'SoftwareApplication', '@id': absolute('/#application'), name: siteName, url,
    description, applicationCategory: 'DesignApplication', operatingSystem: 'Web browser',
    image: imageUrl, license: 'https://github.com/bestagentkits/design-studio-ai/blob/main/LICENSE',
  });
  if (breadcrumbs?.length) graph.push({ '@type': 'BreadcrumbList', '@id': `${url}#breadcrumbs`, itemListElement: breadcrumbs.map((item, index) => ({ '@type': 'ListItem', position: index + 1, name: item.name, item: absolute(item.path) })) });
  const schema = indexable ? `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replaceAll('<', '\\u003c')}</script>` : '';
  return [
    `<title>${escape(title)}</title>`, meta('description', description),
    meta('robots', indexable ? 'index,follow,max-image-preview:large' : 'noindex,follow'),
    `<link rel="canonical" href="${escape(url)}">`,
    meta('og:type', type === 'TechArticle' || type === 'Article' ? 'article' : 'website', true),
    meta('og:site_name', siteName, true), meta('og:locale', 'en_US', true),
    meta('og:title', title, true), meta('og:description', description, true), meta('og:url', url, true),
    meta('og:image', imageUrl, true), meta('og:image:alt', alt, true),
    ...(!image ? [meta('og:image:type', 'image/png', true), meta('og:image:width', '1200', true), meta('og:image:height', '630', true)] : []),
    meta('twitter:card', 'summary_large_image'), meta('twitter:title', title), meta('twitter:description', description),
    meta('twitter:image', imageUrl), meta('twitter:image:alt', alt), schema,
  ].join('\n');
}

export function stripPublicMetadata(html: string) {
  return html.replace(/<title>[\s\S]*?<\/title>/gi, '')
    .replace(/<meta\b[^>]*(?:name="(?:description|robots|twitter:[^"]*)"|property="og:[^"]*")[^>]*>/gi, '')
    .replace(/<link\b[^>]*rel="canonical"[^>]*>/gi, '')
    .replace(/<script\b[^>]*type="application\/ld\+json"[^>]*>[\s\S]*?<\/script>/gi, '');
}

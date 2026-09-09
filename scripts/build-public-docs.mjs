import { build } from 'esbuild';
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'dist');
const sourceOrigin = 'https://studio.agentkit.best';
const configured = new URL(process.env.PUBLIC_SITE_URL || process.env.APP_URL || sourceOrigin);
if (configured.username || configured.password || !['https:', 'http:'].includes(configured.protocol)) throw new Error('PUBLIC_SITE_URL must be an HTTP(S) public origin without credentials.');
const origin = configured.origin;
const template = await readFile(join(output, 'index.html'), 'utf8');
if (!template.includes('id="root"')) throw new Error('Run Vite build before public documentation generation.');
const compilation = await build({
  stdin: {
    contents: `import React from 'react';
import { renderToString, renderToStaticMarkup } from 'react-dom/server';
import { DocsApp, documentationSections, documentationEndpoints, documentationCommands, documentationHref } from './src/app/documentation.tsx';
import { GuideApp } from './src/app/guide.tsx';
export const sections = documentationSections.map(({ id, title, description }) => ({ id, title, description, path: documentationHref(id) }));
export const endpoints = documentationEndpoints;
export const commands = documentationCommands;
export const renderDocs = id => renderToString(React.createElement(DocsApp, { sectionId: id }));
export const renderContent = id => renderToStaticMarkup(React.createElement(documentationSections.find(section => section.id === id).content));
export const renderGuide = () => renderToString(React.createElement(GuideApp));`,
    resolveDir: root,
    loader: 'tsx',
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  loader: { '.css': 'empty' },
  write: false,
  logLevel: 'warning',
});
const temporary = join(root, '.data', `public-docs-${process.pid}.cjs`);
await mkdir(dirname(temporary), { recursive: true });
await writeFile(temporary, compilation.outputFiles[0].contents);
let content;
try { content = createRequire(import.meta.url)(temporary); } finally { await unlink(temporary); }
const cssFiles = (await readdir(join(output, 'assets'))).filter(file => file.endsWith('.css'));
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const decode = value => value.replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16))).replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code))).replaceAll('&quot;', '"').replaceAll('&#x27;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&nbsp;', ' ').replaceAll('&amp;', '&');
const portable = value => value.replaceAll(sourceOrigin, origin);
const absolute = path => new URL(path, origin).href;

function plainInline(html) {
  return decode(html.replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}
function markdown(html, pagePath = "/") {
  const code = [];
  let text = html
    .replace(/<div class="docs-code-bar">[\s\S]*?<\/div>/g, '')
    .replace(/<(script|style|svg|button|label)\b[^>]*>[\s\S]*?<\/\1>/g, '')
    .replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/g, (_, body) => { const index = code.push(`\n\n\`\`\`\n${decode(body.replace(/<\/?code\b[^>]*>/g, '')).trim()}\n\`\`\`\n\n`) - 1; return `\n\n@@DOCS_CODE_${index}@@\n\n`; })
    .replace(/<table\b[^>]*>([\s\S]*?)<\/table>/g, (_, table) => {
      const rows = Array.from(table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g), row => Array.from(row[1].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/g), cell => plainInline(cell[1]).replaceAll('|', '\\|').replace(/\s+/g, ' ')));
      return rows.length ? `\n\n| ${rows[0].join(' | ')} |\n| ${rows[0].map(() => '---').join(' | ')} |\n${rows.slice(1).map(row => `| ${row.join(' | ')} |`).join('\n')}\n\n` : '';
    })
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/g, (_, level, body) => `\n\n${'#'.repeat(Number(level))} ${plainInline(body)}\n\n`)
    .replace(/<summary\b[^>]*>([\s\S]*?)<\/summary>/g, (_, body) => `\n\n### ${plainInline(body)}\n\n`)
    .replace(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g, (_, href, body) => { const label = plainInline(body); return label ? `[${label}](${new URL(decode(href), absolute(pagePath)).href})` : ''; })
    .replace(/<img\b[^>]*src="([^"]+)"[^>]*alt="([^"]*)"[^>]*>/g, (_, src, alt) => `\n\n![${decode(alt)}](${absolute(decode(src))})\n\n`)
    .replace(/<code\b[^>]*>([\s\S]*?)<\/code>/g, (_, body) => `\`${plainInline(body)}\``)
    .replace(/<strong\b[^>]*>([\s\S]*?)<\/strong>/g, (_, body) => ` **${plainInline(body)}** `)
    .replace(/<\/(?:span|small)>/g, ' ')
    .replace(/<li\b[^>]*>/g, '\n- ')
    .replace(/<\/(?:p|div|section|aside|ol|ul|figure|figcaption|nav|header|footer|details)>/g, '\n\n')
    .replace(/<br\s*\/?\s*>/g, '\n')
    .replace(/<[^>]+>/g, '');
  text = decode(text).split('\n').map(line => line.trim()).join('\n').replace(/\n{3,}/g, '\n\n');
  for (const [index, block] of code.entries()) text = text.replace(`@@DOCS_CODE_${index}@@`, block);
  return portable(text.replace(/\n{3,}/g, '\n\n').trim()) + '\n';
}
function page(path, title, description, markup, type = 'TechArticle') {
  let html = template
    .replace(/<title>[\s\S]*?<\/title>/i, `<title>${escape(title)} · Design Studio AI</title>`)
    .replace(/<meta\s+[^>]*(?:name="description"|property="og:[^"]+"|name="twitter:[^"]+")[^>]*>/gi, '')
    .replace(/<script\b[^>]*type="application\/ld\+json"[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<noscript\b[^>]*data-public-docs[^>]*>[\s\S]*?<\/noscript>/gi, '')
    .replace(/<link\s+[^>]*rel="canonical"[^>]*>/gi, '');
  const rootStart = html.indexOf('<div id="root">');
  const rootEnd = html.lastIndexOf('</div>');
  if (rootStart < 0 || rootEnd < rootStart) throw new Error('Expected a root div in the built application shell.');
  html = html.slice(0, rootStart) + `<div id="root">${portable(markup)}</div>` + html.slice(rootEnd + 6);
  const css = cssFiles.filter(file => file.startsWith(path.startsWith('/docs') ? 'documentation-' : path === '/guide' ? 'guide-' : 'index-')).filter(file => !html.includes(`/assets/${file}`)).map(file => `<link rel="stylesheet" href="/assets/${escape(file)}">`).join('\n');
  const jsonLd = JSON.stringify({ '@context': 'https://schema.org', '@type': type, headline: title, description, url: absolute(path), inLanguage: 'en', isPartOf: { '@type': 'WebSite', name: 'Design Studio AI', url: origin }, license: `${repositoryUrl}/blob/main/LICENSE` }).replaceAll('<', '\\u003c');
  const metadata = `<meta name="description" content="${escape(description)}"><link rel="canonical" href="${escape(absolute(path))}"><meta property="og:type" content="website"><meta property="og:title" content="${escape(title)} · Design Studio AI"><meta property="og:description" content="${escape(description)}"><meta property="og:url" content="${escape(absolute(path))}"><meta name="twitter:card" content="summary"><script type="application/ld+json">${jsonLd}</script>${css}<noscript data-public-docs><style>.docs-sidebar{display:flex!important;position:static!important;height:auto!important}.docs-search,.docs-mobile-toggle,.docs-code button,.guide-brief button,.guide-brief-heading label,.appearance-picker{display:none!important}</style></noscript>`;
  return html.replace('</head>', `${metadata}</head>`);
}
const repositoryUrl = 'https://github.com/bestagentkits/design-studio-ai';
const write = async (relative, value) => { const file = join(output, relative); await mkdir(dirname(file), { recursive: true }); await writeFile(file, value); };
const records = [];
for (const section of content.sections) {
  const name = section.path === '/docs' ? 'quickstart' : section.path.split('/').pop();
  const sectionText = section.id === 'rest'
    ? `Base URL: ${origin}. Bodies are JSON unless stated otherwise. Use Authorization: Bearer with a securely injected API key. Cookie writes require a trusted Origin. MCP OAuth cannot manage permanent credentials or provider keys. Replace path IDs and illustrative placeholders with values read from the API.\n\n${content.endpoints.map(endpoint => `## ${endpoint.method} ${endpoint.path}\n\n${endpoint.title}\n\nAuthentication: ${endpoint.auth}.\n\n### Request\n\n\`\`\`\n${endpoint.input}\n\`\`\`\n\n### Response\n\n\`\`\`\n${endpoint.output}\n\`\`\`\n${endpoint.note ? `\n${endpoint.note}\n` : ''}`).join('\n')}\n## Errors and concurrency\n\nApplication errors use {error:{code,message,details?}}. OAuth errors use {error,error_description}. Handle 400 invalid input, 401 authentication, 403 origin/scope, 404 unavailable ownership-scoped resources, 409 revision conflicts, 413 byte/pixel limits, 429 rate limits, and 502/503 upstream/configuration failures. Read and reconcile on a revision conflict; never blindly raise expectedRevision.\n`
    : markdown(content.renderContent(section.id));
  const body = `# ${section.title}\n\n> ${section.description}\n\n${sectionText}`;
  await write(`docs/${name}.md`, body);
  await write(section.path === '/docs' ? 'docs/index.html' : `docs/${name}/index.html`, page(section.path, section.title, section.description, content.renderDocs(section.id)));
  records.push({ ...section, markdownPath: `/docs/${name}.md`, body });
}
const guideMarkup = content.renderGuide();
const guideDescription = 'A visual beginner guide to choosing a template, writing a useful brief, refining a design, inspecting the preview, exporting, and connecting an agent.';
await write('guide/index.html', page('/guide', 'Your first design', guideDescription, guideMarkup, 'Article'));
const guideText = markdown(guideMarkup, '/guide');
const guideMarkdown = guideText.slice(guideText.indexOf('# Your first idea'));
await write('guide.md', guideMarkdown);
await write('docs.md', records[0].body);
await write('docs/index.md', records[0].body);
const summary = 'Design Studio AI is an open-source, agent-first workspace for structured web interfaces, slides, reports, wireframes, 3D scenes, and timeline video. People and agents share one revision-checked document through the web UI, REST, CLI, MCP, and experimental WebMCP.';
const index = `# Design Studio AI\n\n> ${summary}\n\nDocumentation is public. Project, asset, credential, and provider operations require owner authorization. Examples use secure environment injection, never real keys. Generation requires BYOK. REST design generation returns a proposal; the guided UI explicitly saves its first validated draft after scope approval. Publication is separate.\n\n## Start here\n\n- [Beginner guide](${absolute('/guide.md')}): Visual workflow, useful briefs, review, export, and agent connections.\n- [Quickstart](${absolute('/docs/quickstart.md')}): Install the released CLI, inspect templates, and create a project.\n- [Documents and revisions](${absolute('/docs/revisions.md')}): Schema, targeted edits, expectedRevision, and conflicts.\n\n## Reference\n\n${records.filter(record => ['rest', 'cli', 'mcp', 'webmcp', 'api-keys', 'observability'].includes(record.id)).map(record => `- [${record.title}](${absolute(record.markdownPath)}): ${record.description}`).join('\n')}\n- [Live JSON Schemas](${absolute('/api/schema')}): Document, targeted-operation, interview, and scope transport schemas; semantic validation also runs on writes.\n- [Live catalog](${absolute('/api/catalog')}): Templates, themes, and reusable blocks.\n\n## Optional\n\n- [Self-hosting and resources](${absolute('/docs/self-hosting.md')}): Docker, Node, Cloudflare, backups, and capability boundaries.\n- [Full documentation](${absolute('/llms-full.txt')}): All documentation inline in one text file.\n- [Source and releases](${repositoryUrl}): MIT source, CLI tarball, and installable agent skill.\n`;
await write('llms.txt', index);
await write('llms-full.txt', `${index}\n---\n\n${records.map(record => `Source: ${absolute(record.path)}\n\n${record.body}`).join('\n---\n\n')}\n---\n\nSource: ${absolute('/guide')}\n\n${guideMarkdown}`);
const publicPaths = ['/', '/guide', ...content.sections.map(section => section.path)];
await write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${publicPaths.map(path => `  <url><loc>${escape(absolute(path))}</loc></url>`).join('\n')}\n</urlset>\n`);
await write('robots.txt', `User-agent: *\nAllow: /\nDisallow: /api/auth/\nDisallow: /api/projects\nDisallow: /api/assets/\nDisallow: /api/providers\nDisallow: /api/tokens\nDisallow: /oauth/\nDisallow: /mcp\nDisallow: /published/\nDisallow: /*?settings=\n\nSitemap: ${absolute('/sitemap.xml')}\n`);
const homeFallback = `<main class="public-home-fallback"><header><p>DESIGN STUDIO AI</p><h1>A design workspace for people and agents.</h1><p>${escape(summary)}</p><nav><a href="/guide">Beginner guide</a> · <a href="/docs">Documentation</a> · <a href="/docs/api">API reference</a> · <a href="${repositoryUrl}">MIT source</a></nav></header><section><h2>From a clear brief to a useful artifact</h2><p>Choose a template, describe the audience and outcome, inspect the live preview, refine objects and themes, then export or publish an intentional snapshot.</p><h2>One structured document</h2><p>Use REST, the dsa CLI, network MCP with API keys or OAuth, or supported browser WebMCP. Atomic revisions protect concurrent human and agent edits.</p><h2>Your tools, your hosting</h2><p>Bring your own text, image, speech, music, or video provider keys. Run on Cloudflare or self-host using Docker. Template selection and manual editing work without provider credentials.</p></section></main>`;
await write('index.html', page('/', 'Agent-first design workspace', summary, homeFallback, 'WebPage'));
console.log(`Generated ${publicPaths.length} public HTML pages, ${records.length + 3} Markdown files, llms indexes, sitemap, and robots for ${origin}.`);

// Explicit application routes retain real 404s for unknown paths on both hosts.
for (const path of ['templates', 'design-systems', 'activity']) {
  await write(`${path}/index.html`, page(`/${path}`, path === 'templates' ? 'Templates' : path === 'activity' ? 'Activity and usage' : 'Design systems', summary, homeFallback, 'WebPage'));
}

import { applyTemplatePreset, extraTemplates, systemThemes } from './catalog-presets';
import { uid, type DesignDocument, type DesignNode, type DesignPage, type ProjectKind, type Theme } from './schema';
import { structuredPage } from './structured-templates';

export const themes: Theme[] = [
  { id: 'atelier', name: 'Atelier', colors: { background: '#F6F3EC', surface: '#EAE5D9', text: '#282B25', muted: '#73776B', accent: '#BE4B36', primary: '#BE4B36', secondary: '#C3CDA6', border: '#D7D6CA' }, fonts: { heading: 'Georgia', body: 'Arial' }, spacing: [4, 8, 16, 24, 32, 48, 64, 96], radius: 12 },
  { id: 'nocturne', name: 'Nocturne', colors: { background: '#151824', surface: '#242A3D', text: '#F2EFFA', muted: '#ADA9C4', accent: '#C4B1F0', primary: '#C4B1F0', secondary: '#71969A', border: '#353C52' }, fonts: { heading: 'Georgia', body: 'Arial' }, spacing: [4, 8, 16, 24, 32, 48, 64, 96], radius: 16 },
  { id: 'swiss', name: 'Swiss', colors: { background: '#FAFAF7', surface: '#E9E9E3', text: '#141414', muted: '#62625C', accent: '#E7412A', primary: '#E7412A', secondary: '#E5D635', border: '#D5D5CC' }, fonts: { heading: 'Arial', body: 'Arial' }, spacing: [4, 8, 16, 24, 32, 48, 64, 96], radius: 0 },
  { id: 'moss', name: 'Moss', colors: { background: '#EAF0E5', surface: '#D5E0C9', text: '#233B2B', muted: '#687B65', accent: '#44744C', primary: '#44744C', secondary: '#C9AD77', border: '#BCCAB5' }, fonts: { heading: 'Georgia', body: 'Arial' }, spacing: [4, 8, 16, 24, 32, 48, 64, 96], radius: 24 },
  { id: 'cobalt', name: 'Cobalt', colors: { background: '#F0F3FC', surface: '#DCE4F7', text: '#132A56', muted: '#63779B', accent: '#255BDF', primary: '#255BDF', secondary: '#FDCE5B', border: '#C2CFE9' }, fonts: { heading: 'Arial', body: 'Arial' }, spacing: [4, 8, 16, 24, 32, 48, 64, 96], radius: 8 },
  ...systemThemes
];
export interface Template { id: string; name: string; kind: ProjectKind; description: string; themeId: string; category: string }
export const templates: Template[] = [
  { id: 'studio-landing', name: 'A considered beginning', kind: 'web', description: 'An editorial landing page with room to breathe.', themeId: 'atelier', category: 'Landing page' },
  { id: 'product-deck', name: 'Ideas worth sharing', kind: 'slides', description: 'A confident three-slide story for your next big idea.', themeId: 'nocturne', category: 'Presentation' },
  { id: 'brand-guidelines', name: 'A brand, beautifully defined', kind: 'report', description: 'Color, typography, and principles in one source of truth.', themeId: 'moss', category: 'Brand guidelines' },
  { id: 'app-wireframe', name: 'Think before you build', kind: 'wireframe', description: 'A mobile dashboard made of editable building blocks.', themeId: 'swiss', category: 'App & wireframe' },
  { id: 'object-study', name: 'Another dimension', kind: '3d', description: 'A material and light study. Orbit, sculpt, and compose.', themeId: 'cobalt', category: '3D scene' },
  { id: 'motion-title', name: 'Make your words move', kind: 'video', description: 'A short kinetic title with an editable timeline.', themeId: 'nocturne', category: 'Motion & video' },
  { id: 'design-system', name: 'The essentials, in harmony', kind: 'report', description: 'A practical design system with tokens and components.', themeId: 'swiss', category: 'Design system' },
  { id: 'insight-report', name: 'Clarity from complexity', kind: 'report', description: 'An editorial report with a chart and key findings.', themeId: 'atelier', category: 'Report' },
  ...extraTemplates
];

const text = (name: string, x: number, y: number, width: number, height: number, size = 32, heading = false): DesignNode => ({ id: 'text-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 80), type: 'text', name: name.slice(0, 40), text: name, x, y, width, height, style: { fontSize: size, fill: '$text', fontFamily: heading ? '$heading' : '$body', lineHeight: 1.2 } });
const shape = (name: string, x: number, y: number, width: number, height: number, fill = '$surface', radius = 12): DesignNode => ({ id: 'shape-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 80), type: 'shape', name, x, y, width, height, style: { fill, borderRadius: radius } });
export interface Block { id: string; name: string; description: string; nodes: DesignNode[] }
export const blocks: Block[] = [
  { id: 'heading', name: 'Headline', description: 'An expressive headline and supporting copy.', nodes: [text('A better way to create.', 64, 64, 640, 150, 64, true), text('A thoughtful detail makes all the difference.', 64, 240, 620, 70, 22)] },
  { id: 'button', name: 'Button', description: 'An accessible primary call to action.', nodes: [shape('Button', 64, 64, 220, 60, '$accent'), { ...text('Explore the possibilities', 80, 80, 190, 30, 16), style: { fontSize: 16, fill: '$background', fontWeight: 600 } }] },
  { id: 'card', name: 'Feature card', description: 'A reusable card for an idea or feature.', nodes: [shape('Card', 64, 64, 320, 260), text('01 / THE DETAILS', 88, 90, 270, 40, 14), text('Made with intention.', 88, 160, 270, 90, 32, true), text('Small details. Lasting impact.', 88, 270, 270, 30, 16)] },
  { id: 'chart', name: 'Bar chart', description: 'Editable data visualization.', nodes: [{ id: 'block-chart', type: 'chart', name: 'Bar chart', x: 64, y: 64, width: 600, height: 300, data: { labels: ['Discover', 'Design', 'Deliver'], values: [35, 65, 90] }, style: { fill: '$accent' } }] },
  { id: 'image', name: 'Image', description: 'Add an image and set its source from your assets.', nodes: [{ id: 'block-image', type: 'image', name: 'Image', x: 64, y: 64, width: 480, height: 320, style: { fill: '$surface' } }] },
  { id: 'quote', name: 'Pull quote', description: 'Give a meaningful idea a little more space.', nodes: [shape('Quote accent', 64, 64, 4, 160, '$accent', 0), text('“Simplicity is the result of careful thought.”', 96, 64, 600, 160, 40, true)] }
];
export function createBlock(id: string, offset = 0): DesignNode[] {
  const block = blocks.find(b => b.id === id);
  if (!block) throw new Error('Unknown block');
  return structuredClone(block.nodes).map(n => ({ ...n, id: uid(), x: n.x + offset, y: n.y + offset }));
}

export function createDocument(kind: ProjectKind = 'web', name = 'Untitled design', themeId?: string, templateId?: string): DesignDocument {
  const template = templates.find(t => t.id === templateId) ?? templates.find(t => t.kind === kind);
  const theme = structuredClone(themes.find(t => t.id === (themeId ?? template?.themeId)) ?? themes[0]);
  const now = new Date().toISOString();
  const page = (label: string, width = 1440, height = 900, nodes: DesignNode[] = []): DesignPage => ({ id: uid(), name: label, width, height, background: '$background', nodes });
  let pages: DesignPage[];
  if (kind === 'web') {
    pages = [page('Landing page', 1440, 1040, [
      text('FORM & FEEL', 72, 44, 320, 50, 21), text('About     Journal     Get in touch ↗', 938, 50, 440, 40, 17),
      text('GOOD DESIGN. HUMAN BY NATURE.', 72, 164, 700, 30, 14),
      text('Less, but\nmore meaningful.', 72, 230, 840, 240, 92, true),
      text('We bring clarity, character, and a little curiosity\nto the things you put into the world.', 76, 504, 660, 90, 24),
      shape('Primary button', 76, 646, 240, 64, '$accent', 32), { ...text('Let’s make something ↗', 100, 666, 205, 30, 17), style: { fontSize: 17, fill: '$background' } },
      shape('Artwork backing', 963, 212, 372, 486, '$secondary', 180),
      { ...shape('Abstract circle', 996, 322, 270, 270, '$accent', 140), rotation: -15 },
      shape('Art cutout', 1093, 244, 106, 412, '$background', 60),
      shape('Section divider', 72, 800, 1296, 1, '$border', 0),
      text('01 / STRATEGY', 76, 840, 390, 40, 15), text('02 / IDENTITY', 520, 840, 390, 40, 15), text('03 / EXPERIENCE', 965, 840, 390, 40, 15),
      text('Start with a better question.', 76, 897, 390, 70, 30, true), text('Find your own point of view.', 520, 897, 390, 70, 30, true), text('Make every moment matter.', 965, 897, 390, 70, 30, true)
    ])];
  } else if (kind === 'slides') {
    pages = [page('The big idea', 1280, 720, [text('YOUR NEXT CHAPTER / 2026', 72, 54, 720, 40, 17), text('Good ideas\ndeserve great design.', 72, 194, 980, 260, 88, true), text('A presentation for what comes next.', 76, 547, 900, 60, 25), shape('Accent line', 76, 635, 1120, 3, '$accent', 0)]),
      page('A clear perspective', 1280, 720, [text('01 / THE OPPORTUNITY', 72, 54, 900, 40, 17), text('Make the complex\nfeel simple.', 72, 175, 700, 210, 74, true), text('Start with the people. Understand the problem.\nCreate something that makes their day better.', 76, 490, 790, 100, 25), shape('Idea', 950, 200, 220, 300, '$accent', 110)]),
      page('The way forward', 1280, 720, [text('02 / FROM THOUGHT TO THING', 72, 54, 960, 40, 17), text('A little structure.\nA lot of possibility.', 72, 160, 1040, 210, 74, true), ...[0, 1, 2].flatMap((v) => [shape(`Step ${v + 1}`, 72 + v * 385, 430, 355, 180), text(['Discover', 'Create', 'Refine'][v], 96 + v * 385, 478, 307, 60, 36, true), text(['Find the right question.', 'Give your idea a form.', 'Make the details count.'][v], 96 + v * 385, 548, 307, 35, 18)])])];
  } else if (kind === 'wireframe') {
    pages = [page('Mobile dashboard', 390, 844, [text('9:41', 28, 20, 160, 24, 14), text('Good morning,\nAlex.', 28, 92, 310, 105, 40, true), text('YOUR SPACE, AT A GLANCE', 28, 229, 325, 28, 12), shape('Summary', 24, 278, 342, 170), text('Make room for your\nnext great idea.', 46, 312, 300, 95, 28), ...[0, 1, 2].flatMap(i => [shape('List row', 24, 479 + i * 83, 342, 68), text(['Explore your projects', 'Collect inspiration', 'Build something new'][i], 46, 498 + i * 83, 300, 30, 16)]), shape('Navigation', 0, 762, 390, 82, '$text', 0), { ...text('Home      Projects      Library      You', 26, 790, 350, 30, 14), style: { fontSize: 14, fill: '$background' } }])];
  } else if (kind === '3d') {
    pages = [page('Object study', 1280, 800, [text('FORM STUDY / 001', 64, 48, 720, 48, 20), { id: uid(), type: 'model3d', name: 'Sculptural object', x: 390, y: 110, width: 580, height: 580, style: { fill: '$accent' }, data: { geometry: 'torusKnot', color: '#255BDF', metalness: 0.25, roughness: 0.25, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } }, text('Material. Light. Possibility.', 64, 710, 1050, 54, 40, true)])];
  } else if (kind === 'video') {
    pages = [page('Title sequence', 1280, 720, [shape('Motion disc', 940, 110, 270, 270, '$accent', 160), text('A little motion.\nA whole new feeling.', 72, 215, 1050, 270, 80, true), text('DESIGNED TO MOVE / 00:06', 76, 608, 920, 42, 18)])];
  } else {
    const isReport = templateId === 'insight-report';
    pages = [page(isReport ? 'Insights' : 'Brand foundations', 1000, 1250, [text(isReport ? 'FIELD NOTES / 2026' : 'THE BRAND BOOK / 2026', 64, 56, 850, 40, 16), text(isReport ? 'Clarity changes\neverything.' : 'A distinct point\nof view.', 64, 150, 872, 220, 76, true), text(isReport ? 'A considered look at the ideas shaping our next chapter.' : 'The principles, palette, and details that make us, us.', 68, 424, 860, 80, 24), shape('Rule', 64, 555, 872, 2, '$border', 0), text(isReport ? '01 / A PATTERN EMERGES' : '01 / OUR COLOR PALETTE', 64, 595, 872, 35, 15),
      ...(isReport ? [{ id: uid(), type: 'chart' as const, name: 'Overview', x: 68, y: 685, width: 864, height: 260, data: { labels: ['Insight', 'Intention', 'Impact'], values: [32, 58, 88] }, style: { fill: '$accent' } }] : ['$text', '$accent', '$secondary', '$surface'].flatMap((color, i) => [shape('Palette swatch', 64 + i * 224, 684, 200, 200, color, 100), text(['Ink', 'Signature', 'Complement', 'Canvas'][i], 64 + i * 224, 913, 200, 40, 18)])),
      text('Make it clear. Make it honest. Make it memorable.', 64, 1038, 872, 100, 35, true)])];
  }
  for (const page of pages) for (const node of page.nodes) node.id = uid();
  if (kind === 'web' || kind === 'wireframe') pages = [structuredPage(kind === 'wireframe')];
  const doc: DesignDocument = { schemaVersion: 1, id: uid(), name, kind, theme, pages, assets: [], metadata: { createdAt: now, updatedAt: now } };
  if (kind === 'video') doc.timeline = { duration: 6, fps: 30, tracks: [{ id: uid(), nodeId: pages[0].nodes[1].id, keyframes: [{ time: 0, values: { opacity: 0, y: 275 } }, { time: 1.5, values: { opacity: 1, y: 215 } }, { time: 5, values: { opacity: 1, y: 215 } }, { time: 6, values: { opacity: 0, y: 190 } }] }, { id: uid(), nodeId: pages[0].nodes[0].id, keyframes: [{ time: 0, values: { x: 1040, rotation: 0 } }, { time: 6, values: { x: 940, rotation: 180 } }] }] };
  return applyTemplatePreset(doc, templateId);
}

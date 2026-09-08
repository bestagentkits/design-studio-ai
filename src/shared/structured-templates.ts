import { uid, type DesignNode, type DesignPage } from './schema';

export function structuredPage(mobile = false): DesignPage {
  const nodes: DesignNode[] = [];
  const add = (node: Omit<DesignNode, 'id' | 'x' | 'y'>) => { const result = { id: uid(), x: 0, y: 0, ...node }; nodes.push(result); return result.id; };
  const container = (name: string, width: number, height: number, parentId?: string, direction: 'row' | 'column' = 'column') => add({ type: 'frame', name, width, height, parentId, sizing: { width: 'fill', height: 'hug' }, layout: { mode: 'flex', direction, gap: 24, align: 'start', wrap: direction === 'row' } });
  const text = (name: string, value: string, size: number, parentId?: string) => add({ type: 'text', name, text: value, width: mobile ? 330 : 660, height: size * 2.5, parentId, sizing: { width: 'fill', height: 'hug' }, style: { fontSize: size, fontFamily: size > 32 ? '$heading' : '$body', fill: '$text', lineHeight: 1.15 } });
  const component = (name: 'Button' | 'Card' | 'Statistics', label: string, parentId?: string) => add({ type: 'component', name: label, width: name === 'Button' ? 220 : 300, height: name === 'Button' ? 48 : 140, parentId, component: { name, system: 'shadcn', props: { label } }, sizing: { width: name === 'Button' ? 'hug' : 'fill', height: 'hug' } });
  const header = container('Header', 1200, 60, undefined, 'row');
  text('Brand', 'FORM & FEEL', 20, header);
  component('Button', mobile ? 'Your workspace' : 'Get in touch ↗', header);
  const hero = container('Hero', 1200, 580);
  text('Eyebrow', mobile ? 'YOUR SPACE, AT A GLANCE' : 'GOOD DESIGN. HUMAN BY NATURE.', 14, hero);
  text('Headline', mobile ? 'Make room for your next idea.' : 'Less, but more meaningful.', mobile ? 40 : 80, hero);
  text('Introduction', 'Bring clarity, character, and a little curiosity to the things you put into the world.', 24, hero);
  component('Button', 'Explore the possibilities', hero);
  const features = container('Features', 1200, 200, undefined, 'row');
  for (const label of ['Discover your direction', 'Create with intention', 'Make the details count']) component('Card', label, features);
  return { id: uid(), name: mobile ? 'App screen' : 'Landing page', width: mobile ? 390 : 1440, height: mobile ? 844 : 1040, background: '$background', layout: { mode: 'flex', direction: 'column', padding: mobile ? 24 : 64, gap: mobile ? 32 : 64, align: 'stretch' }, nodes };
}

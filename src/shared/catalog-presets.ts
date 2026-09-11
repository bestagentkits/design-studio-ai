import { uid, type DesignDocument, type DesignPage, type DesignNode, type Theme } from './schema';
import type { Template } from './catalog';

export const systemThemes: Theme[] = [
  { id: 'ant-inspired', name: 'Ant Design inspired', colors: { background: '#ffffff', surface: '#f5f5f5', text: '#141414', muted: '#595959', accent: '#1677ff', primary: '#1677ff', secondary: '#e6f4ff', border: '#d9d9d9' }, fonts: { heading: 'Inter', body: 'Inter' }, spacing: [4, 8, 16, 24, 32, 48], radius: 6 },
  { id: 'shadcn-inspired', name: 'shadcn/ui inspired', colors: { background: '#ffffff', surface: '#f4f4f5', text: '#18181b', muted: '#71717a', accent: '#18181b', primary: '#18181b', secondary: '#e4e4e7', border: '#e4e4e7' }, fonts: { heading: 'Inter', body: 'Inter' }, spacing: [4, 8, 16, 24, 32, 48], radius: 8 },
  { id: 'material-inspired', name: 'Material 3 inspired', colors: { background: '#fffbfe', surface: '#f3edf7', text: '#1c1b1f', muted: '#49454f', accent: '#6750a4', primary: '#6750a4', secondary: '#eaddff', border: '#79747e' }, fonts: { heading: 'Roboto', body: 'Roboto' }, spacing: [4, 8, 16, 24, 32, 48], radius: 24 },
  { id: 'carbon-inspired', name: 'IBM Carbon inspired', colors: { background: '#ffffff', surface: '#f4f4f4', text: '#161616', muted: '#525252', accent: '#0f62fe', primary: '#0f62fe', secondary: '#d0e2ff', border: '#8d8d8d' }, fonts: { heading: 'IBM Plex Sans', body: 'IBM Plex Sans' }, spacing: [4, 8, 16, 24, 32, 48, 64], radius: 0 },
  { id: 'atlassian-inspired', name: 'Atlassian inspired', colors: { background: '#ffffff', surface: '#f7f8f9', text: '#172b4d', muted: '#44546f', accent: '#0c66e4', primary: '#0c66e4', secondary: '#cce0ff', border: '#8590a2' }, fonts: { heading: 'Inter', body: 'Inter' }, spacing: [4, 8, 16, 24, 32, 48], radius: 6 },
];
export const extraTemplates: Template[] = [
  { id: 'saas-dashboard', name: 'Operations at a glance', kind: 'web', description: 'A SaaS overview with metrics, chart, and activity table.', themeId: 'carbon-inspired', category: 'Dashboard' },
  { id: 'shop-launch', name: 'A thoughtful storefront', kind: 'web', description: 'Product stories and a clear shopping call to action.', themeId: 'atelier', category: 'Commerce' },
  { id: 'workshop-deck', name: 'Teach something useful', kind: 'slides', description: 'An opening, agenda, and hands-on exercise for a workshop.', themeId: 'material-inspired', category: 'Education' },
  { id: 'project-proposal', name: 'From brief to agreement', kind: 'report', description: 'Scope, milestones, and acceptance criteria for a project.', themeId: 'shadcn-inspired', category: 'Proposal' },
  { id: 'booking-app', name: 'Book your next session', kind: 'wireframe', description: 'A mobile service booking flow with session and confirmation screens.', themeId: 'atlassian-inspired', category: 'Booking' },
  { id: 'product-stage', name: 'Put your product in the light', kind: '3d', description: 'A lit product pedestal with editable material and caption.', themeId: 'atelier', category: 'Product visualization' },
  { id: 'social-announcement', name: 'Something new is coming', kind: 'video', description: 'A square social announcement with staggered motion.', themeId: 'nocturne', category: 'Social media' },
];

function page(name: string, width: number, height: number): DesignPage { return { id: uid(), name, width, height, background: '$background', nodes: [], layout: { mode: 'flex', direction: 'column', padding: width < 500 ? 24 : 48, gap: 20 } }; }
function text(p: DesignPage, content: string, size = 24, height = size * 2) {
  const n: DesignNode = { id: uid(), type: 'text', name: content.slice(0, 50), text: content, x: 0, y: 0, width: p.width - 96, height, sizing: { width: 'fill' }, style: { fontFamily: size > 32 ? '$heading' : '$body', fontSize: size, fill: '$text', lineHeight: 1.2 } }; p.nodes.push(n); return n;
}
function component(p: DesignPage, name: NonNullable<DesignNode['component']>['name'], props: NonNullable<NonNullable<DesignNode['component']>['props']>, height = 60) {
  const n: DesignNode = { id: uid(), type: 'component', name: String(props.label ?? name), x: 0, y: 0, width: p.width - 96, height, sizing: { width: 'fill' }, component: { name, system: 'shadcn', props } }; p.nodes.push(n); return n;
}
export function applyTemplatePreset(doc: DesignDocument, id?: string): DesignDocument {
  if (!extraTemplates.some(t => t.id === id && t.kind === doc.kind)) return doc;
  if (id === 'saas-dashboard') {
    const p = page('Operations overview', 1200, 960); text(p, 'WORKSPACE / OVERVIEW', 16, 28); text(p, 'A clearer view of your week.', 48, 70);
    component(p, 'Statistics', { label: 'Completed tasks · example data', value: 128, suffix: ' tasks' }, 100);
    component(p, 'Chart', { label: 'Weekly delivery · example data', items: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], values: ['18', '25', '21', '30', '34'] }, 290);
    component(p, 'Table', { label: 'Active projects', items: ['Website refresh', 'Customer onboarding', 'Launch campaign'], pageSize: 3 }, 240); doc.pages = [p];
  } else if (id === 'shop-launch') {
    const p = page('Storefront', 1200, 1000); text(p, 'EVERYDAY OBJECTS / NEW COLLECTION', 17, 35); text(p, 'Objects made to be kept.', 68, 110); text(p, 'Considered materials. Useful forms. Discover the story behind your next everyday favorite.', 26, 85);
    component(p, 'Card', { label: 'The morning collection', description: 'Hand-finished ceramics for quiet rituals. Replace this copy with your product story and photography.' }, 220);
    component(p, 'Button', { label: 'Explore the collection' }, 54); text(p, 'Made with care · Small batches · Thoughtful packaging', 20, 50); doc.pages = [p];
  } else if (id === 'workshop-deck') {
    doc.pages = [['Learn by making.', 'WORKSHOP', 'One focused exercise. A useful result.'], ['Today’s agenda', '01 / PLAN YOUR SESSION', 'Understand the problem\nBuild a small first version\nShare, test, and reflect'], ['Your turn to create', '02 / HANDS-ON', 'Choose one problem. Sketch three approaches.\nTest the clearest idea with a partner.']].map(([title, tag, body]) => { const p = page(title, 1280, 720); text(p, tag, 18, 35); text(p, title, 72, 140); text(p, body, 30, 200); p.notes = 'Adapt this slide to your audience. Leave time for questions.'; return p; });
  } else if (id === 'project-proposal') {
    const p = page('Project proposal', 1000, 1300); text(p, 'PROJECT PROPOSAL / DRAFT', 17, 30); text(p, 'A shared direction.', 64, 100); text(p, '01 / The outcome', 30, 50); text(p, 'Describe the user, the problem, and the measurable result this project should deliver.', 24, 110); text(p, '02 / Scope & milestones', 30, 50); component(p, 'List', { items: ['Discover — agree on the brief', 'Design — review the first version', 'Deliver — verify and hand over'] }, 200); text(p, '03 / Acceptance', 30, 50); text(p, 'Record approved requirements, review responsibilities, dates, and what is outside the scope.', 24, 110); doc.pages = [p];
  } else if (id === 'booking-app') {
    const p = page('Choose a session', 390, 844), next = page('Booking details', 390, 844); text(p, 'Make time for you.', 34, 90); component(p, 'Card', { label: 'Studio session', description: 'Choose a time to meet your instructor.' }, 150); component(p, 'Select', { label: 'Choose a day', items: ['Monday', 'Wednesday', 'Friday'] }, 60); const button = component(p, 'Button', { label: 'Continue' }, 50); button.interactions = [{ trigger: 'click', action: 'navigate', target: next.id }]; text(next, 'You’re almost there.', 32, 90); component(next, 'Input', { label: 'Your name', placeholder: 'Name' }, 50); component(next, 'Input', { label: 'Email', placeholder: 'you@example.com' }, 50); component(next, 'Button', { label: 'Confirm booking' }, 50); text(next, 'Prototype only — connect your booking service before accepting reservations.', 16, 100); doc.pages = [p, next];
  } else if (id === 'product-stage') {
    const p = page('Product stage', 1280, 800); delete p.layout;
    p.nodes = [{ id: uid(), type: 'model3d', name: 'Pedestal', x: 440, y: 430, width: 400, height: 140, data: { geometry: 'cylinder' }, scene: { position: [0, -.9, 0], scale: [1.5, .25, 1.5], material: { color: '#d4c9b4', roughness: .8, metalness: 0 } } }, { id: uid(), type: 'model3d', name: 'Product', x: 490, y: 160, width: 300, height: 300, data: { geometry: 'torus' }, scene: { position: [0, .3, 0], material: { color: '#be4b36', roughness: .2, metalness: .3 } } }];
    const title = text(p, 'The everyday, elevated.', 44, 60); title.x = 64; title.y = 670; doc.pages = [p];
  } else {
    const p = page('Social announcement', 1080, 1080); const tag = text(p, 'SAVE THE DATE', 24, 60); text(p, 'Something\nworth waiting for.', 90, 300); text(p, 'Your next chapter starts here.', 32, 80); const cta = component(p, 'Button', { label: 'Discover what’s next' }, 65); doc.pages = [p]; doc.timeline = { duration: 5, fps: 30, tracks: [tag, cta].map((n, i) => ({ id: uid(), nodeId: n.id, keyframes: [{ time: 0, values: { opacity: 0 } }, { time: .5 + i, values: { opacity: 1 }, easing: 'easeOut' }, { time: 5, values: { opacity: 1 } }] })) };
  }
  return doc;
}

import { documentSchema, type DesignDocument, type DesignNode } from './schema';
import { visitDocumentAssetIds } from './document-asset-references';
import type { CharacterInstance } from './character-schema';

export const COMMUNITY_PROJECTION_POLICY_VERSION = 1;
export interface CommunityDisclosure {
  policyVersion: number;
  removedNodes: number;
  removedBoardElements: number;
  removedAssets: number;
  removedNotes: number;
  flattenedPaintings: number;
  assets: { id: string; name: string; mimeType: string }[];
  editability: string[];
}

function hiddenIds(items: {id: string; parentId?: string; visible?: boolean}[]) {
  const hidden = new Set(items.filter(n => n.visible === false).map(n => n.id));
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of items) if (node.parentId && hidden.has(node.parentId) && !hidden.has(node.id)) { hidden.add(node.id); changed = true; }
  }
  return hidden;
}

/** Only renderer-owned fields survive the otherwise opaque data dictionary. */
function publicNodeData(node: DesignNode) {
  const source = node.data ?? {}, data: Record<string, unknown> = {};
  if (node.type === 'chart') {
    if (Array.isArray(source.values)) data.values = source.values.slice(0, 30).map(v => typeof v === 'number' && Number.isFinite(v) ? v : 0);
    if (Array.isArray(source.labels)) data.labels = source.labels.slice(0, 30).map(v => typeof v === 'string' ? v.slice(0, 2000) : '');
  }
  if (['chart', 'model3d'].includes(node.type) && typeof source.color === 'string' && /^(?:\$[\w-]+|#[\da-fA-F]{3,8}|[a-zA-Z]{1,30}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%]+\))$/.test(source.color)) data.color = source.color;
  const shapes = ['ellipse', 'sphere', 'torus', 'torusKnot', 'cone', 'cylinder', 'box'];
  if (['shape', 'model3d'].includes(node.type) && typeof source.shape === 'string' && shapes.includes(source.shape)) data.shape = source.shape;
  if (node.type === 'model3d') {
    if (typeof source.geometry === 'string' && shapes.includes(source.geometry)) data.geometry = source.geometry;
    for (const key of ['depth', 'z', 'rotationX', 'rotationY', 'metalness', 'roughness']) if (typeof source[key] === 'number' && Number.isFinite(source[key])) data[key] = source[key];
    if (typeof source.rigSourceId === 'string') data.rigSourceId = source.rigSourceId;
  }
  return Object.keys(data).length ? data : undefined;
}

function publicComponentProps(node:DesignNode) {
  if(!node.component)return;
  const used:Record<string,string[]>={Button:['disabled'],Checkbox:['checked','disabled'],Input:['value','placeholder','disabled'],Textarea:['value','placeholder','disabled'],InputNumber:['value','placeholder','disabled','min','max'],Slider:['value','disabled','min','max'],Image:[],Avatar:[],List:['items'],Statistics:['value','suffix'],Table:['items','pageSize'],Select:['value','items','disabled'],Switch:['checked','disabled'],Card:['description'],Badge:['value'],Progress:['value'],Tabs:['items','description','value'],Radio:['items','value','disabled'],Chart:['items','values'],Dialog:['description','disabled']};
  const allowed=new Set(['label',...used[node.component.name]??[]]);
  node.component.props=Object.fromEntries(Object.entries(node.component.props??{}).filter(([name])=>allowed.has(name)));
}

/** A separate, versioned Community policy; legacy share/export semantics stay unchanged. */
export function communityProjection(input: DesignDocument): { document: DesignDocument; disclosure: CommunityDisclosure } {
  const doc = documentSchema.parse(input);
  const disclosure: CommunityDisclosure = { policyVersion: COMMUNITY_PROJECTION_POLICY_VERSION, removedNodes: 0, removedBoardElements: 0, removedAssets: 0, removedNotes: 0, flattenedPaintings: 0, assets: [], editability: ['Visible structure remains editable.'] };
  const boards = new Set<string>(), instances = new Map<string, CharacterInstance[]>();
  const composite = (id: string) => {
    const painting = doc.schemaVersion === 2 ? doc.paintings.find(p => p.id === id) : undefined;
    if (!painting?.composite || painting.composite.generation !== painting.generation) throw new Error('Save the painting to create a verified visible composite before publishing to Community.');
    const asset = doc.assets.find(a => a.id === painting.composite!.assetId);
    if (!asset) throw new Error('The verified painting composite is missing. Save the painting again before publishing.');
    disclosure.flattenedPaintings++;
    return asset;
  };
  for (const page of doc.pages) {
    if (page.notes) disclosure.removedNotes++;
    delete page.notes;
    const hidden = hiddenIds(page.nodes);
    disclosure.removedNodes += hidden.size;
    page.nodes = page.nodes.filter(n => !hidden.has(n.id));
    const visible = new Set(page.nodes.map(n => n.id));
    for (const node of page.nodes) {
      node.data = publicNodeData(node);
      publicComponentProps(node);
      const rigId = node.scene?.rigId ?? node.data?.rigSourceId;
      if (typeof rigId === 'string' && !visible.has(rigId)) throw new Error(`Visible model "${node.name}" depends on a hidden rig. Make its rig public or detach it before publishing.`);
      if (node.interactions) node.interactions = node.interactions.filter(i => i.action !== 'toggle' || visible.has(i.target));
      if (node.scene?.material?.layers) node.scene.material.layers = node.scene.material.layers.filter(l => l.visible !== false);
      if (node.boardId) boards.add(node.boardId);
      if (node.type === 'artwork' && node.paintingId) { node.src = composite(node.paintingId).url; node.type = 'image'; delete node.paintingId; }
      if (node.character) instances.set(node.character.characterId, [...instances.get(node.character.characterId) ?? [], node.character]);
    }
  }
  if (doc.schemaVersion === 2) {
    doc.boards = doc.boards.filter(b => boards.has(b.id));
    for (const board of doc.boards) {
      const hidden = hiddenIds(board.elements);
      const before = board.elements.length;
      board.elements = board.elements.filter(e => !hidden.has(e.id) && !(e.type === 'connector' && [e.start, e.end].some(p => p.binding && hidden.has(p.binding.elementId)))).map(e => {
        if (e.type !== 'painting') return e;
        const { paintingId, ...rest } = e;
        return { ...rest, type: 'image' as const, assetId: composite(paintingId).id };
      });
      disclosure.removedBoardElements += before - board.elements.length;
      const ids = new Set(board.elements.map(e => e.id));
      if (board.mindMap) board.mindMap = board.mindMap.filter(m => ids.has(m.elementId)).map(m => m.parentId && !ids.has(m.parentId) ? { ...m, parentId: undefined } : m);
    }
    doc.paintings = [];
  }
  doc.characters = doc.characters?.filter(c => instances.has(c.id));
  for (const character of doc.characters ?? []) {
    const uses = instances.get(character.id)!;
    const skins = new Set(uses.map(i => i.skinId).filter(Boolean));
    character.skins = character.skins.filter(s => skins.has(s.id));
    const clips = new Set(uses.flatMap(i => [i.clipId, ...i.placements.map(p => p.clipId), ...i.interactions.map(p => p.clipId)]).filter(Boolean));
    // All sliders participate in pose evaluation, including ones without an explicit control.
    for (const constraint of character.constraints) if (constraint.clipId) clips.add(constraint.clipId);
    character.clips = character.clips.filter(c => clips.has(c.id));
    for (const clip of character.clips) { delete clip.bakedFrom; clip.channels = clip.channels.filter(c => !c.muted); }
    const publicSlots = new Set(character.slots.filter(slot => slot.opacity > 0 || character.clips.some(clip => clip.channels.some(channel => channel.target === 'slot' && channel.targetId === slot.id && channel.property === 'opacity' && channel.keys.some(key => typeof key.value === 'number' && key.value > 0)))).map(slot => slot.id));
    const used = new Set<string>();
    for (const skin of character.skins) skin.attachments = Object.fromEntries(Object.entries(skin.attachments).filter(([slot]) => publicSlots.has(slot)));
    for (const slot of character.slots.filter(slot => publicSlots.has(slot.id))) for (const instance of uses) {
      const skin = character.skins.find(s => s.id === instance.skinId);
      const attachment = skin?.attachments[slot.id] ?? slot.attachmentId;
      if (attachment) used.add(attachment);
    }
    for (const clip of character.clips) for (const channel of clip.channels) if (channel.property === 'attachment' && publicSlots.has(channel.targetId)) for (const key of channel.keys) if (typeof key.value === 'string' && key.value) used.add(key.value);
    // Deformation of an attachment that can never be displayed is private unused source.
    for (const clip of character.clips) clip.channels = clip.channels.filter(channel => channel.target !== 'attachment' || used.has(channel.targetId)).filter(channel => channel.property !== 'attachment' || publicSlots.has(channel.targetId));
    for (const attachment of character.attachments.filter(a => used.has(a.id))) if (attachment.sourceMeshId) {
      const source = character.attachments.find(a => a.id === attachment.sourceMeshId);
      if (!source?.mesh) throw new Error('A public linked mesh has no valid source geometry. Repair the character before publishing.');
      // Linked geometry is required; the source attachment's private image and name are not.
      attachment.mesh = structuredClone(source.mesh);
      delete attachment.sourceMeshId;
    }
    character.attachments = character.attachments.filter(a => used.has(a.id));
    for (const slot of character.slots) if (slot.attachmentId && !used.has(slot.attachmentId)) delete slot.attachmentId;
  }
  const nodeIds = new Set(doc.pages.flatMap(p => p.nodes.map(n => n.id)));
  if (doc.timeline) {
    doc.timeline.tracks = doc.timeline.tracks.filter(t => nodeIds.has(t.nodeId) && !t.muted);
    for (const track of doc.timeline.tracks) for (const key of track.keyframes) key.values = Object.fromEntries(Object.entries(key.values).filter(([name]) => /^(x|y|width|height|rotation|opacity|fill|fontSize|borderRadius|strokeWidth|stroke)$/.test(name) || /^scene\.(?:(?:position|rotation|scale)\.[xyz]|bones\.\d+\.(?:position|rotation)\.[xyz]|morphWeights\.[a-zA-Z0-9_-]+)$/.test(name)));
  }
  delete doc.designSystem;
  doc.id = 'community-document';
  doc.theme.id = 'community-theme';
  const assets = new Set<string>();
  visitDocumentAssetIds(doc, id => { assets.add(id); return id; });
  for (const page of doc.pages) for (const node of page.nodes) if (node.src) for (const asset of doc.assets) if (asset.url === node.src) assets.add(asset.id);
  const originalAssets = doc.assets.length;
  doc.assets = doc.assets.filter(a => assets.has(a.id)).map((a, index) => ({ ...a, name: `Media ${index + 1}`, type: a.mimeType.split('/')[0] }));
  disclosure.removedAssets = originalAssets - doc.assets.length;
  disclosure.assets = doc.assets.map(({ id, name, mimeType }) => ({ id, name, mimeType }));
  if (disclosure.flattenedPaintings) disclosure.editability.push('Paintings are shared as visible image composites; source layers and masks are excluded.');
  if (doc.characters?.length) disclosure.editability.push('Characters retain the skins, clips and attachments used by visible instances.');
  const parsed = documentSchema.safeParse(doc);
  if (!parsed.success) throw new Error(`The public design has an unsafe or missing dependency. Repair the visible design before publishing: ${parsed.error.issues[0]?.message}`);
  return { document: parsed.data, disclosure };
}

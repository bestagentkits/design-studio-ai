import type {DesignDocument} from './schema';
export function motionDuration(doc:DesignDocument){return Math.max(doc.timeline?.duration??0,...doc.pages.flatMap(p=>p.nodes.flatMap(n=>{const i=n.character,c=doc.characters?.find(c=>c.id===i?.characterId);return i&&c?[...i.placements.map(p=>p.end),c.clips.find(c=>c.id===i.clipId)?.duration??0]:[];})));}

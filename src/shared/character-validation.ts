import {worldMatrices} from './character-math';
import type { Character, CharacterInstance } from './character-schema';

/** Validate reference graphs before evaluating or allocating render resources. */
export function characterErrors(c: Character, assetIds: Set<string>): string[] {
  const errors: string[] = [], ids = new Set<string>();
  const add = (id: string) => { if (ids.has(id) || ['__proto__','constructor','prototype'].includes(id)) errors.push(`Duplicate or reserved ID: ${id}`); ids.add(id); };
  const bones = new Map(c.bones.map(b => [b.id,b])), slots = new Map(c.slots.map(s => [s.id,s])), attachments = new Map(c.attachments.map(a => [a.id,a])), clips = new Map(c.clips.map(a => [a.id,a])), constraints = new Map(c.constraints.map(a => [a.id,a]));
  const exists = (condition: unknown, message: string) => { if (!condition) errors.push(message); };
  const graph = new Map<string,string[]>();
  for (const bone of c.bones) { add(bone.id); exists(!bone.parentId || bones.has(bone.parentId), `Unknown parent of ${bone.id}`); graph.set(bone.id,bone.parentId ? [bone.parentId] : []); }
  for (const slot of c.slots) { add(slot.id); exists(bones.has(slot.boneId),`Unknown bone of ${slot.id}`); exists(!slot.attachmentId || attachments.get(slot.attachmentId)?.slotId === slot.id,`Invalid attachment of ${slot.id}`); }
  exists(c.attachments.filter(a=>a.kind==='clipping').length<=8,'At most 8 clipping attachments per character');
  let vertices=0, keys=0;
  for (const a of c.attachments) {
    add(a.id); exists(slots.has(a.slotId),`Unknown slot of ${a.id}`);
    if (['region','mesh','sequence'].includes(a.kind)) exists(a.assetId && assetIds.has(a.assetId),`Missing image asset for ${a.id}`);
    if (a.frames) for (const id of a.frames) exists(assetIds.has(id),`Missing sequence asset ${id}`);
    if (a.kind === 'sequence') exists(a.frames?.length && a.fps, `Sequence ${a.id} needs frames and fps`);
    if (a.kind === 'clipping' || a.kind === 'bounds') exists(a.points?.length,`Missing polygon for ${a.id}`);
    if (a.clipEndSlotId) exists(slots.has(a.clipEndSlotId) && c.slots.findIndex(s=>s.id===a.clipEndSlotId)>c.slots.findIndex(s=>s.id===a.slotId),`Clipping end must follow ${a.slotId}`);
    if (a.sourceMeshId) exists(attachments.get(a.sourceMeshId)?.mesh && !attachments.get(a.sourceMeshId)?.sourceMeshId,`Linked mesh ${a.id} needs a direct mesh source`);
    if (a.kind === 'mesh') exists(a.mesh || a.sourceMeshId,`Missing mesh for ${a.id}`);
    if (a.mesh) {
      const m=a.mesh; vertices+=m.vertices.length;
      exists(m.uv.length===m.vertices.length && m.triangles.length%3===0 && m.triangles.every(i=>i<m.vertices.length),`Invalid mesh topology: ${a.id}`);
      if (m.weights) {
        exists(m.weights.length===m.vertices.length,`Missing vertex weights: ${a.id}`);
        for (const w of m.weights) exists(Math.abs(w.reduce((s,i)=>s+i.weight,0)-1)<1e-5 && new Set(w.map(i=>i.boneId)).size===w.length && w.every(i=>bones.has(i.boneId)),`Invalid normalized weights: ${a.id}`);
      }
    }
  }
  exists(vertices<=20000,'Character exceeds 20000 mesh vertices');
  for (const skin of c.skins) { add(skin.id); for (const [s,a] of Object.entries(skin.attachments)) exists(slots.has(s) && attachments.get(a)?.slotId===s,`Invalid skin attachment ${s}`); }
  const properties = { bone:['x','y','rotation','scaleX','scaleY'], slot:['opacity','attachment','order'], attachment:['deform'], constraint:['mix','targetX','targetY','position','value'] };
  for (const clip of c.clips) {
    add(clip.id); const channels = new Set<string>();
    for (const ch of clip.channels) {
      add(ch.id); const targets={bone:bones,slot:slots,attachment:attachments,constraint:constraints};
      exists(targets[ch.target].has(ch.targetId) && properties[ch.target].includes(ch.property),`Invalid channel target/property: ${ch.id}`);
      const signature=`${ch.target}:${ch.targetId}:${ch.property}`; exists(!channels.has(signature),`Duplicate channel: ${signature}`); channels.add(signature);
      const times=new Set<number>();
      for(const key of ch.keys) {
        add(key.id); keys++; exists(key.time<=clip.duration && !times.has(key.time),`Duplicate or out-of-range key time: ${key.id}`); times.add(key.time);
        if(ch.property==='attachment') exists(typeof key.value==='string' && (key.value==='' || attachments.get(key.value)?.slotId===ch.targetId),`Invalid keyed attachment: ${key.id}`);
        else if(ch.property==='deform') {
          const a=attachments.get(ch.targetId), m=a?.mesh ?? attachments.get(a?.sourceMeshId ?? '')?.mesh;
          exists(m && m.version===ch.meshVersion && Array.isArray(key.value) && key.value.length===m.vertices.length*2,`Deformation topology mismatch: ${key.id}`);
        } else exists(typeof key.value==='number',`Numeric channel needs numeric keys: ${key.id}`);
        if(['opacity','mix','value','position'].includes(ch.property)) exists(typeof key.value==='number' && key.value>=0 && key.value<=1,`Key must be in 0..1: ${key.id}`);
      }
    }
    for(const e of clip.events) { add(e.id); exists(e.time<=clip.duration,`Event exceeds clip duration: ${e.id}`); }
  }
  exists(keys<=20000,'Character exceeds 20000 keys');
  for(const constraint of c.constraints) {
    add(constraint.id); exists(new Set(constraint.bones).size===constraint.bones.length && constraint.bones.every(id=>bones.has(id)),`Invalid constrained bones: ${constraint.id}`);
    exists(!constraint.targetBoneId || bones.has(constraint.targetBoneId),`Unknown constraint target: ${constraint.id}`);
    exists(constraint.min===undefined || constraint.max===undefined || constraint.min<=constraint.max,`Invalid constraint range: ${constraint.id}`);
    if(constraint.type==='ik') exists(constraint.bones.length<=2 && (constraint.bones.length===1 || bones.get(constraint.bones[1])?.parentId===constraint.bones[0]),`IK needs one bone or a parent/child pair: ${constraint.id}`);
    if(constraint.type==='path') exists(constraint.path && (constraint.path.length-1)%3===0,`Path needs connected cubic segments: ${constraint.id}`);
    if(constraint.type==='transform') exists(constraint.targetBoneId,`Transform constraint needs target bone: ${constraint.id}`);
    if(constraint.targetBoneId) for(const id of constraint.bones) graph.get(id)?.push(constraint.targetBoneId);
    if(constraint.type==='slider') {
      const clip=clips.get(constraint.clipId ?? ''); exists(clip,`Slider needs pose clip: ${constraint.id}`);
      exists(!clip?.channels.some(ch=>ch.target==='constraint'),`Pose clips cannot drive constraints recursively: ${constraint.id}`);
    }
  }
  const done=new Set<string>(),active=new Set<string>();
  const visit=(id:string):boolean=>{ if(active.has(id)) return false; if(done.has(id)) return true; active.add(id); for(const parent of graph.get(id)??[]) if(!visit(parent)) return false; active.delete(id); done.add(id); return true; };
  for(const id of graph.keys()) if(!visit(id)) { errors.push('Bone/constraint dependency cycle'); break; }
  if(!errors.length){const world=worldMatrices(c.bones,Object.fromEntries(c.bones.map(b=>[b.id,b])));if(Object.values(world).some(m=>m.some(v=>!Number.isFinite(v)||Math.abs(v)>1e9)))errors.push('Accumulated bone transforms exceed numeric budget');}
  return errors;
}
export function instanceErrors(i: CharacterInstance,c: Character):string[] {
  const errors:string[]=[], placements=new Set<string>(), clips=new Map(c.clips.map(x=>[x.id,x]));
  if(i.skinId && !c.skins.some(s=>s.id===i.skinId)) errors.push('Unknown character skin');
  if(i.clipId && !clips.has(i.clipId)) errors.push('Unknown character clip');
  for(const p of i.placements) { const clip=clips.get(p.clipId); if(placements.has(p.id) || !clip || p.end<=p.start || p.sourceStart>=clip.duration || p.fadeIn+p.fadeOut>p.end-p.start || p.mask?.some(id=>!c.bones.some(b=>b.id===id))) errors.push(`Invalid clip placement: ${p.id}`); placements.add(p.id); }
  for(const id of Object.keys(i.controls??{})) if(!c.constraints.some(x=>x.id===id && x.type==='slider')) errors.push(`Unknown slider: ${id}`);
  for(const trigger of i.interactions) if(!clips.has(trigger.clipId)) errors.push('Unknown interaction clip');
  return errors;
}

export function characterEvolutionErrors(previous:Character[],next:Character[]):string[]{
 const errors:string[]=[];
 for(const before of previous){const after=next.find(c=>c.id===before.id);if(!after)continue;
  for(const a of before.attachments){const b=after.attachments.find(x=>x.id===a.id);if(!a.mesh||!b?.mesh)continue;
   const changed=a.mesh.vertices.length!==b.mesh.vertices.length||JSON.stringify(a.mesh.triangles)!==JSON.stringify(b.mesh.triangles);
   if(changed&&b.mesh.version<=a.mesh.version)errors.push(`Mesh ${a.id} topology changed without a new version`);
  }
 }
 return errors;
}

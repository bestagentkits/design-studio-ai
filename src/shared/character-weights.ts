import type {Character} from './character-schema';
import {worldMatrices,point,multiply} from './character-math';
import {attachmentMatrix} from './character-runtime';
export function automaticWeights(c:Character,attachmentId:string){
 const a=c.attachments.find(a=>a.id===attachmentId);if(!a?.mesh)throw new Error('Select an independent mesh');
 const world=worldMatrices(c.bones,Object.fromEntries(c.bones.map(b=>[b.id,b]))),slot=c.slots.find(s=>s.id===a.slotId)!;
 const segments=c.bones.map(b=>({id:b.id,a:point(world[b.id],[0,0]),b:point(world[b.id],[b.length,0])}));
 return a.mesh.vertices.map(v=>{const p=point(multiply(world[slot.boneId],attachmentMatrix(a)),v);
  const influences=segments.map(s=>{const dx=s.b[0]-s.a[0],dy=s.b[1]-s.a[1],t=Math.max(0,Math.min(1,((p[0]-s.a[0])*dx+(p[1]-s.a[1])*dy)/Math.max(1e-9,dx*dx+dy*dy)));return {boneId:s.id,weight:1/Math.max(1,Math.hypot(p[0]-s.a[0]-t*dx,p[1]-s.a[1]-t*dy)**2)};}).sort((a,b)=>b.weight-a.weight).slice(0,4);
  const sum=influences.reduce((s,i)=>s+i.weight,0);return influences.map(i=>({...i,weight:i.weight/sum}));
 });
}

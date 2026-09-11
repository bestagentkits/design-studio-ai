import {nodeMatrix} from './scene-constraints';
import {scenePose,rigOwner} from './scene-shared-rig';
import * as T from 'three';
import type { DesignDocument, DesignNode } from './schema';
import { boneWorld } from './scene-rigging';
type Mesh=NonNullable<NonNullable<DesignNode['scene']>['mesh']>;
// Document edits replace mesh objects; pose sampling reuses immutable buffers.
// Cache topology once per mesh so full-animation scans do not rebuild edge maps.
const topologyCache=new WeakMap<Mesh,Map<string,ReturnType<typeof computeTopology>>>();
function computeTopology(mesh:Mesh,nodeId:string){
  const edges=new Map<string,{count:number;direction:number}>(),issues:string[]=[],diagnostics:{id:string;message:string;vertices:number[];faces:number[];severity:'warning'|'info'}[]=[];const add=(id:string,message:string,vertices:number[]=[],faces:number[]=[],severity:'warning'|'info'='warning')=>diagnostics.push({id:`${nodeId}:${id}`,message,vertices:vertices.slice(0,256),faces:faces.slice(0,256),severity});let degenerate=0,badWeights=0;
  for(let i=0;i<mesh.indices.length;i+=3){const ids=mesh.indices.slice(i,i+3),p=ids.map(v=>new T.Vector3().fromArray(mesh.positions,v*3));if(p[1].sub(p[0]).cross(p[2].sub(p[0])).lengthSq()<1e-16){degenerate++;if(degenerate<=32)add(`face-${i/3}`,'Degenerate triangle',ids,[i/3]);}for(let j=0;j<3;j++){const a=ids[j],b=ids[(j+1)%3],key=[a,b].sort((a,b)=>a-b).join(':');const edge=edges.get(key)??{count:0,direction:0};edge.count++;edge.direction+=a<b?1:-1;edges.set(key,edge);}}
  const positionKey=(i:number)=>mesh.positions.slice(i*3,i*3+3).map(v=>Math.round(v*1e7)).join(':');const geometric=new Map<string,number>();for(const [key,e] of edges){const ids=key.split(':').map(Number),geo=ids.map(positionKey).sort().join('|');geometric.set(geo,(geometric.get(geo)??0)+e.count);}
  for(const [key,e] of edges){if(diagnostics.length>=128)break;const ids=key.split(':').map(Number);if(e.count===1){const seam=(geometric.get(ids.map(positionKey).sort().join('|'))??0)===2;add(`edge-${key}`,seam?'Duplicated seam boundary':'Open boundary',ids,[],seam?'info':'warning');}else if(e.count>2||e.direction!==0)add(`edge-${key}`,e.count>2?'Non-manifold edge':'Inconsistent winding',ids);}
  const boundary=[...edges.values()].filter(e=>e.count===1).length,nonManifold=[...edges.values()].filter(e=>e.count>2).length,inconsistent=[...edges.values()].filter(e=>e.count===2&&e.direction!==0).length;
  if(mesh.skinWeights)for(let i=0;i<mesh.positions.length/3;i++)if(Math.abs(mesh.skinWeights.slice(i*4,i*4+4).reduce((a,b)=>a+b,0)-1)>.0001){badWeights++;if(badWeights<=32)add(`weight-${i}`,'Unnormalized vertex weights',[i]);}
  if(degenerate)issues.push(`${degenerate} degenerate triangles`);if(boundary)issues.push(`${boundary} boundary edges (UV seams can split vertices)`);if(nonManifold)issues.push(`${nonManifold} non-manifold edges`);if(inconsistent)issues.push(`${inconsistent} inconsistent edge windings`);if(badWeights)issues.push(`${badWeights} unnormalized vertices`);
  const bounds=new T.Box3().setFromArray(mesh.positions);
  return {issues,diagnostics,bounds:{min:bounds.min.toArray(),max:bounds.max.toArray()},edges:[...edges.keys()].map(key=>{const [a,b]=key.split(':').map(Number);return {a,b,length:new T.Vector3().fromArray(mesh.positions,a*3).distanceTo(new T.Vector3().fromArray(mesh.positions,b*3))};})};
}
function topology(mesh:Mesh,nodeId:string){let entries=topologyCache.get(mesh);if(!entries){entries=new Map();topologyCache.set(mesh,entries);}let value=entries.get(nodeId);if(!value){value=computeTopology(mesh,nodeId);entries.set(nodeId,value);}return value;}
export function inspectScene(doc:DesignDocument,pageId?:string,time=0){return {time,pages:doc.pages.filter(p=>!pageId||p.id===pageId).map(p=>({id:p.id,nodes:p.nodes.filter(n=>n.type==='model3d').map(n=>inspectNode({...n,scene:{...n.scene,bones:rigOwner(n,doc).scene?.bones}},scenePose(n,doc,time)))}))};}
export function inspectNode(node:DesignNode,pose:DesignNode){
  const mesh=node.scene?.mesh,bones=node.scene?.bones??[];if(!mesh)return {id:node.id,name:node.name,editableMesh:false,issues:['Convert primitive or import editable geometry before rigging']};
  const cached=topology(mesh,node.id),edges=cached.edges,issues=[...cached.issues],diagnostics=[...cached.diagnostics];
  const deformed=new T.Box3();let maxStretch=1;
  const rest=boneWorld(bones,true),world=boneWorld(pose.scene?.bones??bones),skin=world.map((m,i)=>m.clone().multiply(rest[i].clone().invert())),vertices:T.Vector3[]=[];
  for(let i=0;i<mesh.positions.length/3;i++){const v=new T.Vector3().fromArray(mesh.positions,i*3);mesh.morphTargets?.forEach(t=>v.addScaledVector(new T.Vector3().fromArray(t.positions,i*3),pose.scene?.morphWeights?.[t.name]??0));const out=new T.Vector3();if(mesh.skinIndices&&skin.length)for(let j=0;j<4;j++)out.addScaledVector(v.clone().applyMatrix4(skin[mesh.skinIndices[i*4+j]]),mesh.skinWeights![i*4+j]);else out.copy(v);vertices.push(out);deformed.expandByPoint(out);}
  const affected=new Set<number>();
  for(const {a,b,length} of edges)if(length>1e-8){const stretch=vertices[a].distanceTo(vertices[b])/length;maxStretch=Math.max(maxStretch,stretch);if(stretch>3){affected.add(a);affected.add(b);}}
  if(maxStretch>3)diagnostics.push({id:`${node.id}:stretch`,message:'Pose stretches edges over 3×',vertices:[...affected].slice(0,256),faces:[],severity:'warning'});
  if(maxStretch>3)issues.push('Pose stretches some edges over 3×; inspect joint weights');
  return {id:node.id,name:node.name,editableMesh:true,vertices:mesh.positions.length/3,triangles:mesh.indices.length/3,bones:bones.map((b,i)=>({index:i,name:b.name,parent:b.parent,position:new T.Vector3().setFromMatrixPosition(world[i]).toArray()})),skinned:!!mesh.skinIndices,morphTargets:mesh.morphTargets?.map(t=>t.name)??[],bounds:cached.bounds,poseBounds:{min:deformed.min.toArray(),max:deformed.max.toArray()},maxEdgeStretch:maxStretch,issues,diagnostics};
}

export function inspectSceneAnimation(doc:DesignDocument,pageId:string,start=0,end=doc.timeline?.duration??0,samples=25){
 if(!Number.isInteger(samples)||![start,end].every(Number.isFinite)||samples<2||samples>61||start<0||end<start||end>3600)throw new Error('Choose 2–61 samples in a valid timeline range');
 const page=doc.pages.find(p=>p.id===pageId);if(!page)throw new Error('Unknown page');
 return {pageId,start,end,samples,frames:Array.from({length:samples},(_,i)=>{const time=start+(end-start)*i/(samples-1),report=inspectScene(doc,pageId,time);return {time,nodes:report.pages[0].nodes.map(n=>({id:n.id,diagnostics:'diagnostics' in n?(n.diagnostics??[]).filter(d=>i===0||d.severity==='warning'):[],maxEdgeStretch:'maxEdgeStretch' in n?n.maxEdgeStretch:undefined})),contacts:page.nodes.flatMap(node=>{const pose=scenePose(node,doc,time),world=boneWorld(pose.scene?.bones??[]),matrix=nodeMatrix(pose,page);return (node.scene?.constraints??[]).filter(c=>c.enabled&&time>=c.start&&time<=c.end).map(c=>{const index=pose.scene!.bones!.findIndex(b=>b.name===c.endBone),p=new T.Vector3().setFromMatrixPosition(world[index]).applyMatrix4(matrix),target=new T.Vector3(...c.target);if(c.groundHeight!==undefined)target.y=c.groundHeight;return {nodeId:node.id,id:c.id,error:p.distanceTo(target),penetration:c.groundHeight===undefined?0:Math.max(0,c.groundHeight-p.y)};});})};})};
}

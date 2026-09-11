import * as T from 'three';
import type { DesignDocument, DesignNode } from './schema';
import { boneWorld } from './scene-rigging';
import { interpolateNode } from './render';
export function inspectScene(doc:DesignDocument,pageId?:string,time=0){return {time,pages:doc.pages.filter(p=>!pageId||p.id===pageId).map(p=>({id:p.id,nodes:p.nodes.filter(n=>n.type==='model3d').map(n=>inspectNode(n,interpolateNode(n,doc,time)))}))};}
function inspectNode(node:DesignNode,pose:DesignNode){
  const mesh=node.scene?.mesh,bones=node.scene?.bones??[];if(!mesh)return {id:node.id,name:node.name,editableMesh:false,issues:['Convert primitive or import editable geometry before rigging']};
  const edges=new Map<string,{count:number;direction:number}>(),issues:string[]=[];let degenerate=0,badWeights=0;
  for(let i=0;i<mesh.indices.length;i+=3){const ids=mesh.indices.slice(i,i+3),p=ids.map(v=>new T.Vector3().fromArray(mesh.positions,v*3));if(p[1].sub(p[0]).cross(p[2].sub(p[0])).lengthSq()<1e-16)degenerate++;for(let j=0;j<3;j++){const a=ids[j],b=ids[(j+1)%3],key=[a,b].sort((a,b)=>a-b).join(':');const edge=edges.get(key)??{count:0,direction:0};edge.count++;edge.direction+=a<b?1:-1;edges.set(key,edge);}}
  const boundary=[...edges.values()].filter(e=>e.count===1).length,nonManifold=[...edges.values()].filter(e=>e.count>2).length,inconsistent=[...edges.values()].filter(e=>e.count===2&&e.direction!==0).length;
  if(mesh.skinWeights)for(let i=0;i<mesh.positions.length/3;i++)if(Math.abs(mesh.skinWeights.slice(i*4,i*4+4).reduce((a,b)=>a+b,0)-1)>.0001)badWeights++;
  if(degenerate)issues.push(`${degenerate} degenerate triangles`);if(boundary)issues.push(`${boundary} boundary edges (UV seams can split vertices)`);if(nonManifold)issues.push(`${nonManifold} non-manifold edges`);if(inconsistent)issues.push(`${inconsistent} inconsistent edge windings`);if(badWeights)issues.push(`${badWeights} unnormalized vertices`);
  const bounds=new T.Box3().setFromArray(mesh.positions),deformed=new T.Box3();let maxStretch=1;
  const rest=boneWorld(bones,true),world=boneWorld(pose.scene?.bones??bones),skin=world.map((m,i)=>m.clone().multiply(rest[i].clone().invert())),vertices:T.Vector3[]=[];
  for(let i=0;i<mesh.positions.length/3;i++){const v=new T.Vector3().fromArray(mesh.positions,i*3);mesh.morphTargets?.forEach(t=>v.addScaledVector(new T.Vector3().fromArray(t.positions,i*3),pose.scene?.morphWeights?.[t.name]??0));const out=new T.Vector3();if(mesh.skinIndices&&skin.length)for(let j=0;j<4;j++)out.addScaledVector(v.clone().applyMatrix4(skin[mesh.skinIndices[i*4+j]]),mesh.skinWeights![i*4+j]);else out.copy(v);vertices.push(out);deformed.expandByPoint(out);}
  for(const key of edges.keys()){const [a,b]=key.split(':').map(Number),length=new T.Vector3().fromArray(mesh.positions,a*3).distanceTo(new T.Vector3().fromArray(mesh.positions,b*3));if(length>1e-8)maxStretch=Math.max(maxStretch,vertices[a].distanceTo(vertices[b])/length);}
  if(maxStretch>3)issues.push('Pose stretches some edges over 3×; inspect joint weights');
  return {id:node.id,name:node.name,editableMesh:true,vertices:mesh.positions.length/3,triangles:mesh.indices.length/3,bones:bones.map((b,i)=>({index:i,name:b.name,parent:b.parent,position:new T.Vector3().setFromMatrixPosition(world[i]).toArray()})),skinned:!!mesh.skinIndices,morphTargets:mesh.morphTargets?.map(t=>t.name)??[],bounds:{min:bounds.min.toArray(),max:bounds.max.toArray()},poseBounds:{min:deformed.min.toArray(),max:deformed.max.toArray()},maxEdgeStretch:maxStretch,issues};
}

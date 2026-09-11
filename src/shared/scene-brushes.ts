import {Vector3} from 'three';
import type {MeshData} from './design-capabilities';
import {adjacency} from './scene-mesh-topology';
export function paintWeights(mesh:MeshData,bone:number,center:number[],radius:number,strength:number,mode:'add'|'subtract'|'smooth',lockedBones:number[],lockedVertices:number[]){
 if(!mesh.skinIndices||!mesh.skinWeights)throw new Error('Bind this mesh before painting weights');
 if(lockedBones.includes(bone))throw new Error('Selected bone is locked');
 for(let i=0;i<mesh.skinWeights.length;i+=4)if(Math.abs(mesh.skinWeights.slice(i,i+4).reduce((a,b)=>a+b,0)-1)>.0001)throw new Error('Normalize skin weights before brushing');
 const ids=[...mesh.skinIndices],weights=[...mesh.skinWeights],links=adjacency(mesh),blocked=new Set(lockedVertices),locked=new Set(lockedBones),point=new Vector3().fromArray(center);
 for(let i=0;i<mesh.positions.length/3;i++){
  const distance=new Vector3().fromArray(mesh.positions,i*3).distanceTo(point);if(blocked.has(i)||distance>radius)continue;
  const current=new Map<number,number>();for(let j=0;j<4;j++)current.set(ids[i*4+j],(current.get(ids[i*4+j])??0)+weights[i*4+j]);
  const old=current.get(bone)??0,falloff=strength*(1-distance/radius)**2;
  let target=mode==='add'?Math.min(1,old+falloff):Math.max(0,old-falloff);
  if(mode==='smooth'){let sum=0;for(const v of links[i])for(let j=0;j<4;j++)if(ids[v*4+j]===bone)sum+=weights[v*4+j];target=old+(sum/Math.max(1,links[i].size)-old)*falloff;}
  const fixed=[...current].filter(([id,w])=>locked.has(id)&&w>0),reserved=fixed.reduce((s,[,w])=>s+w,0);
  if(fixed.length>=4)continue;target=Math.min(target,1-reserved);
  const others=[...current].filter(([id,w])=>id!==bone&&!locked.has(id)&&w>0).sort((a,b)=>b[1]-a[1]).slice(0,3-fixed.length);
  if(!others.length&&target<1-reserved)continue;
  const sum=others.reduce((s,[,w])=>s+w,0),values=[...fixed,[bone,target],...others.map(([id,w])=>[id,w/sum*(1-reserved-target)])];
  for(let j=0;j<4;j++){mesh.skinIndices[i*4+j]=values[j]?.[0]??0;mesh.skinWeights[i*4+j]=values[j]?.[1]??0;}
 }
}
export function sculpt(mesh:MeshData,center:number[],radius:number,strength:number,mode:'smooth'|'inflate'|'move',delta:number[]){
 const positions=[...mesh.positions],links=adjacency(mesh),point=new Vector3().fromArray(center),normals=Array.from({length:positions.length/3},()=>new Vector3());
 if(mode==='inflate')for(let i=0;i<mesh.indices.length;i+=3){const [a,b,c]=mesh.indices.slice(i,i+3),p=new Vector3().fromArray(positions,a*3),normal=new Vector3().fromArray(positions,b*3).sub(p).cross(new Vector3().fromArray(positions,c*3).sub(p));for(const v of [a,b,c])normals[v].add(normal);}
 for(let i=0;i<positions.length/3;i++){const p=new Vector3().fromArray(positions,i*3),distance=p.distanceTo(point);if(distance>radius)continue;const falloff=strength*(1-distance/radius)**2;let change=new Vector3().fromArray(delta);
  if(mode==='inflate')change=normals[i].normalize().multiplyScalar(radius*.1);
  if(mode==='smooth'){change=new Vector3();for(const j of links[i])change.add(new Vector3().fromArray(positions,j*3));change.divideScalar(Math.max(1,links[i].size)).sub(p);}
  p.addScaledVector(change,falloff);mesh.positions.splice(i*3,3,...p.toArray());
 }
}
/** Split each requested edge in every incident face, retaining all interpolated vertex data. */
export function splitEdges(mesh:MeshData,edges:[number,number][],fractions:number[]=[]){
 for(const [edgeIndex,[a,b]] of edges.entries()){const t=fractions[edgeIndex]??.5;if(a===b||a>=mesh.positions.length/3||b>=mesh.positions.length/3)throw new Error('Unknown edge');
  if(!mesh.indices.some((v,i)=>i%3===0&&mesh.indices.slice(i,i+3).includes(a)&&mesh.indices.slice(i,i+3).includes(b)))throw new Error('Selected vertices do not form an edge');
  if(mesh.positions.length>=899997||mesh.indices.length+6>1800000)throw new Error('Mesh refinement budget reached');
  const m=mesh.positions.length/3;
  for(const [buffer,width] of [[mesh.positions,3],[mesh.uv,2],[mesh.colors,3],...(mesh.morphTargets??[]).map(t=>[t.positions,3])] as [number[]|undefined,number][]){if(buffer)for(let j=0;j<width;j++)buffer.push(buffer[a*width+j]*(1-t)+buffer[b*width+j]*t);}
  if(mesh.skinIndices&&mesh.skinWeights){const values=new Map<number,number>();for(const v of [a,b])for(let j=0;j<4;j++)values.set(mesh.skinIndices[v*4+j],(values.get(mesh.skinIndices[v*4+j])??0)+mesh.skinWeights[v*4+j]*(v===a?1-t:t));const top=[...values].sort((a,b)=>b[1]-a[1]).slice(0,4),sum=top.reduce((s,[,w])=>s+w,0);if(sum<=0)throw new Error('Normalize skin weights before refining');for(let j=0;j<4;j++){mesh.skinIndices.push(top[j]?.[0]??0);mesh.skinWeights.push((top[j]?.[1]??0)/sum);}}
  const triangles:number[]=[];for(let i=0;i<mesh.indices.length;i+=3){const ids=mesh.indices.slice(i,i+3);let split=false;for(let j=0;j<3;j++){const x=ids[j],y=ids[(j+1)%3],z=ids[(j+2)%3];if((x===a&&y===b)||(x===b&&y===a)){triangles.push(x,m,z,m,y,z);split=true;break;}}if(!split)triangles.push(...ids);}mesh.indices=triangles;
 }
}

/** Insert a continuous cut across crossing triangles; topology remains explicitly triangular. */
export function insertLoop(mesh:MeshData,axis:0|1|2,offset:number){
 const edges=new Map<string,[number,number]>();for(let i=0;i<mesh.indices.length;i+=3)for(let j=0;j<3;j++){const a=mesh.indices[i+j],b=mesh.indices[i+(j+1)%3],x=mesh.positions[a*3+axis]-offset,y=mesh.positions[b*3+axis]-offset;if(x*y<-1e-12)edges.set([a,b].sort((a,b)=>a-b).join(':'),[a,b]);}
 if(!edges.size)throw new Error('The cut plane does not cross any mesh edges');if(edges.size>2000)throw new Error('Cut crosses more than 2000 edges; refine a smaller mesh');
 const values=[...edges.values()];splitEdges(mesh,values,values.map(([a,b])=>(offset-mesh.positions[a*3+axis])/(mesh.positions[b*3+axis]-mesh.positions[a*3+axis])));
}

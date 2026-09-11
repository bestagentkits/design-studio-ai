import * as T from 'three';
import type { MeshData } from './design-capabilities';
/** Cut explicit seams, project connected islands and pack into padded equal atlas cells. */
export function packUV(mesh:MeshData,seams:number[][]){
  const key=(a:number,b:number)=>[a,b].sort((a,b)=>a-b).join(':'),cuts=new Set(seams.map(([a,b])=>key(a,b)));
  const count=mesh.positions.length/3;if(seams.some(s=>s.some(v=>v>=count)))throw new Error('UV seam references an unknown vertex');
  const faceCount=mesh.indices.length/3,links=Array.from({length:faceCount},()=>new Set<number>()),edges=new Map<string,number[]>();
  for(let f=0;f<faceCount;f++)for(let j=0;j<3;j++){const k=key(mesh.indices[f*3+j],mesh.indices[f*3+(j+1)%3]);if(!cuts.has(k)){const faces=edges.get(k)??[];faces.push(f);edges.set(k,faces);}}
  for(const faces of edges.values())for(const a of faces)for(const b of faces)if(a!==b)links[a].add(b);
  const islands:number[][]=[],seen=new Set<number>();for(let f=0;f<faceCount;f++)if(!seen.has(f)){const queue=[f];seen.add(f);for(let i=0;i<queue.length;i++)for(const next of links[queue[i]])if(!seen.has(next)){seen.add(next);queue.push(next);}islands.push(queue);}
  // Without supplied seams use per-triangle islands: guaranteed non-overlap for arbitrary topology.
  const groups=seams.length?islands:Array.from({length:faceCount},(_,i)=>[i]);
  const result:MeshData={positions:[],indices:[],uv:[],...(mesh.skinIndices?{skinIndices:[],skinWeights:[]}:{}),...(mesh.colors?{colors:[]}:{}),...(mesh.morphTargets?{morphTargets:mesh.morphTargets.map(t=>({name:t.name,positions:[]}))}:{})};
  const columns=Math.ceil(Math.sqrt(groups.length));
  groups.forEach((faces,island)=>{const vertices=[...new Set(faces.flatMap(f=>mesh.indices.slice(f*3,f*3+3)))],normal=new T.Vector3();for(const f of faces){const ps=mesh.indices.slice(f*3,f*3+3).map(i=>new T.Vector3().fromArray(mesh.positions,i*3));normal.add(ps[1].sub(ps[0]).cross(ps[2].sub(ps[0])));}const axes=[0,1,2].sort((a,b)=>Math.abs(normal.getComponent(a))-Math.abs(normal.getComponent(b))).slice(0,2);const min=axes.map(a=>vertices.reduce((m,v)=>Math.min(m,mesh.positions[v*3+a]),Infinity)),max=axes.map(a=>vertices.reduce((m,v)=>Math.max(m,mesh.positions[v*3+a]),-Infinity));const mapping=new Map<number,number>();for(const v of vertices){mapping.set(v,result.positions.length/3);result.positions.push(...mesh.positions.slice(v*3,v*3+3));result.uv!.push(...axes.map((a,j)=>(((mesh.positions[v*3+a]-min[j])/(max[j]-min[j]||1)*.9+.05)+(j?Math.floor(island/columns):island%columns))/columns));if(mesh.skinIndices){result.skinIndices!.push(...mesh.skinIndices.slice(v*4,v*4+4));result.skinWeights!.push(...mesh.skinWeights!.slice(v*4,v*4+4));}if(mesh.colors)result.colors!.push(...mesh.colors.slice(v*3,v*3+3));mesh.morphTargets?.forEach((t,i)=>result.morphTargets![i].positions.push(...t.positions.slice(v*3,v*3+3)));}for(const f of faces)result.indices.push(...mesh.indices.slice(f*3,f*3+3).map(v=>mapping.get(v)!));});
  if(result.positions.length>900000)throw new Error('UV atlas exceeds vertex budget; simplify the mesh first');return result;
}

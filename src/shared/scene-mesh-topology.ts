import { meshDistance } from './mesh-distance';
import { geometryFor, meshData } from './scene-runtime';
import * as T from 'three';
import type { MeshData } from './design-capabilities';
import type { DesignNode } from './schema';
export function adjacency(mesh: MeshData) {
  const links = Array.from({ length: mesh.positions.length / 3 }, () => new Set<number>());
  for (let i = 0; i < mesh.indices.length; i += 3) for (let j = 0; j < 3; j++) { const a = mesh.indices[i+j], b = mesh.indices[i+(j+1)%3]; links[a].add(b); links[b].add(a); }
  return links;
}
export function relax(mesh: MeshData, iterations: number, strength: number) {
  const links = adjacency(mesh);
  for (let step = 0; step < iterations; step++) {
    const old = [...mesh.positions];
    links.forEach((neighbors, i) => { if (neighbors.size) for (let axis = 0; axis < 3; axis++) mesh.positions[i*3+axis] = old[i*3+axis]*(1-strength) + [...neighbors].reduce((s,j)=>s+old[j*3+axis],0)/neighbors.size*strength; });
  }
}
export function loft(rings: { center: number[]; radius: number }[], segments: number): MeshData {
  const positions: number[] = [], indices: number[] = [], uv: number[] = [];
  let previousU:T.Vector3|undefined;
  rings.forEach((ring, r) => {
    const direction = new T.Vector3().fromArray(rings[Math.min(r+1,rings.length-1)].center).sub(new T.Vector3().fromArray(rings[Math.max(0,r-1)].center));
    if (direction.lengthSq()<1e-12) throw new Error('Loft centers must be distinct');
    direction.normalize(); const u = new T.Vector3(0,1,0); if (Math.abs(direction.y)>.9) u.set(1,0,0); u.cross(direction).normalize(); if(previousU){u.copy(previousU).addScaledVector(direction,-previousU.dot(direction)).normalize();}previousU=u.clone(); const v = direction.clone().cross(u);
    for (let s=0;s<segments;s++) { const a=s/segments*Math.PI*2; positions.push(...new T.Vector3().fromArray(ring.center).addScaledVector(u,Math.cos(a)*ring.radius).addScaledVector(v,Math.sin(a)*ring.radius).toArray()); uv.push(s/segments,r/(rings.length-1)); }
    if(r) for(let s=0;s<segments;s++){const a=(r-1)*segments+s,b=(r-1)*segments+(s+1)%segments,c=r*segments+s,d=r*segments+(s+1)%segments;indices.push(a,b,c,b,d,c);}
  });
  for(const r of [0,rings.length-1]){const center=positions.length/3;positions.push(...rings[r].center);uv.push(.5,.5);for(let s=0;s<segments;s++){const a=r*segments+s,b=r*segments+(s+1)%segments;indices.push(center,...(r?[a,b]:[b,a]));}}
  return {positions,indices,uv};
}
/** Smooth implicit union of transformed ellipsoids, sampled on a bounded symmetric grid. */
export function remesh(nodes: DesignNode[], resolution: number, symmetry: boolean, blend: number): MeshData {
  if(nodes.reduce((sum,n)=>sum+(n.scene?.mesh?.indices.length??0)/3,0)>20000)throw new Error('Remesh source meshes exceed 20,000 triangles in total');
  const shapes = nodes.map(n=>{
    if(n.src || n.parentId) throw new Error('Remesh accepts unparented document geometry. Imported asset geometry must be converted first.');
    const p=new T.Vector3(...(n.scene?.position??[0,0,0])), s=new T.Vector3(...(n.scene?.scale??[1,1,1]));
    if(Math.min(s.x,s.y,s.z)<=0)throw new Error('Remesh needs positive scale');
    const q=new T.Quaternion().setFromEuler(new T.Euler(...(n.scene?.rotation??[0,0,0]).map(v=>v*Math.PI/180) as [number,number,number]));let distance:ReturnType<typeof meshDistance>|undefined;if(n.scene?.mesh||(n.data?.geometry??n.data?.shape)!=='sphere'){const geometry=geometryFor(n);try{distance=meshDistance(meshData(geometry),new T.Matrix4().compose(p,q,s));}finally{geometry.dispose();}}return {p,s,q:q.invert(),radius:Math.max(s.x,s.y,s.z),distance};
  });
  const extent=Math.max(...shapes.map(s=>s.distance?Math.max(...s.distance.bounds.min.toArray().map(Math.abs),...s.distance.bounds.max.toArray().map(Math.abs)):Math.max(Math.abs(s.p.x),Math.abs(s.p.y),Math.abs(s.p.z))+s.radius))+blend*2;
  const min=new T.Vector3(-extent,-extent,-extent), h=2*extent/resolution;
  const field=(p:T.Vector3)=>{if(symmetry)p=new T.Vector3(Math.abs(p.x),p.y,p.z);let result=Infinity; for(const s of shapes) for(const mirror of symmetry?[1,-1]:[1]) { const point=p.clone();point.x*=mirror;const d=s.distance?s.distance.distance(point):(point.sub(s.p).applyQuaternion(s.q).divide(s.s).length()-1)*Math.min(s.s.x,s.s.y,s.s.z); if(!Number.isFinite(result))result=d;else {const k=Math.max(blend-Math.abs(result-d),0)/blend;result=Math.min(result,d)-k*k*blend*.25;} }return result;};
  const positions:number[]=[],indices:number[]=[],verts=new Map<string,number>();
  const offsets=[[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]];
  const tetra=[[0,5,1,6],[0,1,2,6],[0,2,3,6],[0,3,7,6],[0,7,4,6],[0,4,5,6]];
  const samples=new Float32Array((resolution+1)**3), at=(x:number,y:number,z:number)=>(z*(resolution+1)+y)*(resolution+1)+x;
  for(let z=0;z<=resolution;z++)for(let y=0;y<=resolution;y++)for(let x=0;x<=resolution;x++)samples[at(x,y,z)]=field(new T.Vector3(x,y,z).multiplyScalar(h).add(min));
  for(let z=0;z<resolution;z++)for(let y=0;y<resolution;y++)for(let x=0;x<resolution;x++){
    const ids=offsets.map(o=>at(x+o[0],y+o[1],z+o[2])), ds=ids.map(i=>samples[i]);if(ds.every(d=>d>=0)||ds.every(d=>d<0))continue;
    const ps=offsets.map(o=>new T.Vector3(x+o[0],y+o[1],z+o[2]).multiplyScalar(h).add(min));
    const edge=(a:number,b:number)=>{const key=[ids[a],ids[b]].sort((a,b)=>a-b).join(':');let id=verts.get(key);if(id===undefined){id=positions.length/3;verts.set(key,id);positions.push(...ps[a].clone().lerp(ps[b],ds[a]/(ds[a]-ds[b])).toArray());}return id;};
    const tri=(a:number,b:number,c:number)=>{const pa=new T.Vector3().fromArray(positions,a*3),pb=new T.Vector3().fromArray(positions,b*3),pc=new T.Vector3().fromArray(positions,c*3);const n=pb.clone().sub(pa).cross(pc.clone().sub(pa)).normalize(),center=pa.add(pb).add(pc).divideScalar(3);if(field(center.clone().addScaledVector(n,h*.01))<field(center.clone().addScaledVector(n,-h*.01)))indices.push(a,c,b);else indices.push(a,b,c);};
    for(const t of tetra){const inside=t.filter(i=>ds[i]<0),outside=t.filter(i=>ds[i]>=0);if(!inside.length||!outside.length)continue;if(inside.length===1||outside.length===1){const one=inside.length===1?inside[0]:outside[0],rest=inside.length===1?outside:inside;tri(edge(one,rest[0]),edge(one,rest[1]),edge(one,rest[2]));}else {const [a,b]=inside,[c,d]=outside,A=edge(a,c),B=edge(a,d),C=edge(b,c),D=edge(b,d);tri(A,B,C);tri(B,D,C);}}
  }
  if(!indices.length)throw new Error('Resolution missed the surface; enlarge the shapes or raise resolution');
  const mesh={positions,indices};relax(mesh,2,.15);return mesh;
}

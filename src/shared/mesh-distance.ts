import * as T from 'three';
import type { MeshData } from './design-capabilities';
interface Branch { box:T.Box3; left?:Branch; right?:Branch; triangles?:T.Triangle[] }
/** A bounded triangle BVH supports closest-surface distance and parity queries during remeshing. */
export function meshDistance(mesh:MeshData,matrix:T.Matrix4){
  if(mesh.indices.length/3>20000)throw new Error('Remesh supports at most 20,000 source triangles per object');
  const points=Array.from({length:mesh.positions.length/3},(_,i)=>new T.Vector3().fromArray(mesh.positions,i*3).applyMatrix4(matrix));
  const triangles:T.Triangle[]=[];for(let i=0;i<mesh.indices.length;i+=3)triangles.push(new T.Triangle(points[mesh.indices[i]],points[mesh.indices[i+1]],points[mesh.indices[i+2]]));
  const build=(items:T.Triangle[]):Branch=>{const box=new T.Box3();for(const t of items){box.expandByPoint(t.a);box.expandByPoint(t.b);box.expandByPoint(t.c);}if(items.length<=12)return {box,triangles:items};const size=box.getSize(new T.Vector3()),axis=size.x>size.y?(size.x>size.z?'x':'z'):(size.y>size.z?'y':'z');items.sort((a,b)=>(a.a[axis]+a.b[axis]+a.c[axis])-(b.a[axis]+b.b[axis]+b.c[axis]));const mid=Math.floor(items.length/2);return {box,left:build(items.slice(0,mid)),right:build(items.slice(mid))};};
  const root=build(triangles),direction=new T.Vector3(1,.371,.529).normalize();
  return {bounds:root.box,distance:(p:T.Vector3)=>{let best=Infinity,hits=0;const closest=new T.Vector3(),intersection=new T.Vector3(),ray=new T.Ray(p,direction);
    const nearest=(node:Branch)=>{if(node.box.distanceToPoint(p)**2>best)return;if(node.triangles){for(const t of node.triangles){t.closestPointToPoint(p,closest);best=Math.min(best,closest.distanceToSquared(p));}}else{const children=[node.left!,node.right!].sort((a,b)=>a.box.distanceToPoint(p)-b.box.distanceToPoint(p));nearest(children[0]);nearest(children[1]);}};
    const crossings=(node:Branch)=>{if(!ray.intersectsBox(node.box))return;if(node.triangles){for(const t of node.triangles)if(ray.intersectTriangle(t.a,t.b,t.c,false,intersection)&&intersection.distanceToSquared(p)>1e-16)hits++;}else{crossings(node.left!);crossings(node.right!);}};
    nearest(root);crossings(root);return Math.sqrt(best)*(hits%2?-1:1);
  }};
}

import {Matrix4,SkinnedMesh} from 'three';
/** Three exports a skin per mesh. Coalesce only identical joints and float32 bind matrices. */
export function sharedSkinPlugin(writer:any){
 const entries:{object:SkinnedMesh;node:{skin?:number}}[]=[];
 return {name:'StudioSharedSkins',writeNode(object:any,node:any){if(object instanceof SkinnedMesh)entries.push({object,node});},afterParse(){
  const skins=writer.json.skins;if(!skins)return;
  const unique:any[]=[],keys=new Map<string,number>(),remap=new Map<number,number>();
  for(const {object,node} of entries){if(node.skin===undefined)continue;const skin=skins[node.skin],values=new Float32Array(object.skeleton.bones.length*16);
   object.skeleton.boneInverses.forEach((inverse,i)=>new Matrix4().copy(inverse).multiply(object.bindMatrix).toArray(values,i*16));
   const key=JSON.stringify([skin.joints,Array.from(values)]);let index=keys.get(key);if(index===undefined){index=unique.length;keys.set(key,index);unique.push(skin);}remap.set(node.skin,index);
  }
  // Imported or extension-provided skins not observed by writeNode must survive intact.
  skins.forEach((skin:any,i:number)=>{if(!remap.has(i)){remap.set(i,unique.length);unique.push(skin);}});
  for(const node of writer.json.nodes??[])if(node.skin!==undefined)node.skin=remap.get(node.skin);
  writer.json.skins=unique;
 }};
}

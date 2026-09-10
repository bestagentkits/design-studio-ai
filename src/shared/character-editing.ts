import {uid} from './schema';
import {characterSchema,boneSchema,slotSchema,attachmentSchema,motionClipSchema,type Character,type BonePose,type CharacterMesh,type MotionKey} from './character-schema';
import {inverse,multiply,transform,worldMatrices,degrees} from './character-math';
export function newCharacter(name='Character'):Character {return characterSchema.parse({id:uid(),name,width:512,height:512,bones:[{id:uid(),name:'Root',x:256,y:256}],slots:[],attachments:[],skins:[],clips:[]});}
export function addCharacterLayer(c:Character,assetId:string,name:string,width:number,height:number,x=0,y=0){
 const bone=boneSchema.parse({id:uid(),name,parentId:c.bones[0].id,x,y,length:width/2});c.bones.push(bone);
 const slot=slotSchema.parse({id:uid(),name,boneId:bone.id}),a=attachmentSchema.parse({id:uid(),name,slotId:slot.id,assetId,kind:'region',width,height});slot.attachmentId=a.id;c.slots.push(slot);c.attachments.push(a);
}
export function reparentBone(c:Character,id:string,parentId:string|undefined,keepWorld:boolean){
 const bone=c.bones.find(b=>b.id===id)!;if(!keepWorld){bone.parentId=parentId;return;}
 const world=worldMatrices(c.bones,Object.fromEntries(c.bones.map(b=>[b.id,b]))),m=parentId?multiply(inverse(world[parentId]),world[id]):world[id];
 const sx=Math.hypot(m[0],m[1]),sy=(m[0]*m[3]-m[1]*m[2])/Math.max(sx,1e-10);
 // Shear cannot be represented by the rig's TRS contract; reject rather than move artwork silently.
 const pose={x:m[4],y:m[5],rotation:degrees(Math.atan2(m[1],m[0])),scaleX:sx,scaleY:sy};
 if(transform(pose).some((v,i)=>Math.abs(v-m[i])>1e-5))throw new Error('This parent introduces shear. Disable keep world pose or use a uniform parent scale.');
 Object.assign(bone,pose,{parentId});
}
export function keyBone(c:Character,clipId:string,boneId:string,time:number,values:Partial<BonePose>){
 const clip=c.clips.find(c=>c.id===clipId)!;
 for(const [property,value] of Object.entries(values)){
  let channel=clip.channels.find(ch=>ch.target==='bone'&&ch.targetId===boneId&&ch.property===property);
  if(!channel){channel={id:uid(),target:'bone',targetId:boneId,property:property as keyof BonePose,keys:[]};clip.channels.push(channel);}
  if(channel.locked)throw new Error('Unlock the channel first');
  const existing=channel.keys.find(k=>k.time===time);if(existing)existing.value=value!;else channel.keys.push({id:uid(),time,value:value!});
 }
}
export function gridMesh(width:number,height:number,columns=4,rows=4):CharacterMesh {
 const vertices:[number,number][]=[],uv:[number,number][]=[],triangles:number[]=[];
 for(let y=0;y<=rows;y++)for(let x=0;x<=columns;x++){vertices.push([width*x/columns,height*y/rows]);uv.push([x/columns,y/rows]);if(x<columns&&y<rows){const i=y*(columns+1)+x;triangles.push(i,i+1,i+columns+1,i+1,i+columns+2,i+columns+1);}}
 return {version:1,vertices,uv,triangles};
}
export function retimeKeys(keys:MotionKey[],ids:Set<string>,offset:number,scale:number,pivot:number,duration:number,copy=false){
 const moving=keys.filter(k=>ids.has(k.id)).map(k=>({...k,id:copy?uid():k.id,time:Math.round((pivot+(k.time-pivot)*scale+offset)*10000)/10000}));
 const result=[...keys.filter(k=>copy||!ids.has(k.id)),...moving];
 if(result.some(k=>k.time<0||k.time>duration)||new Set(result.map(k=>k.time)).size!==result.length)throw new Error('Key times collide or exceed clip duration. Nothing was changed.');
 return result.sort((a,b)=>a.time-b.time);
}
export const newClip=(name='Animation')=>motionClipSchema.parse({id:uid(),name,duration:2,loop:true,channels:[]});

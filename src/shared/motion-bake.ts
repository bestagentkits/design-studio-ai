import {uid} from './schema';
import {characterInstanceSchema,type Character,type MotionClip} from './character-schema';
import {evaluateCharacter} from './character-runtime';
export function bakeMotion(c:Character,sourceClipId:string,clipId:string,name:string,fps:number):MotionClip{
 const source=c.clips.find(x=>x.id===sourceClipId);if(!source)throw new Error('Unknown source clip');
 if(!Number.isInteger(fps)||fps<1||fps>60)throw new Error('Bake FPS must be 1–60');
 const count=Math.ceil(source.duration*fps)+1;
 const instance=characterInstanceSchema.parse({characterId:c.id,clipId:sourceClipId}),channels:MotionClip['channels']=[];
 for(const b of c.bones)for(const property of ['x','y','rotation','scaleX','scaleY'] as const)channels.push({id:uid(),target:'bone',targetId:b.id,property,keys:[]});
 for(const s of c.slots)for(const property of ['attachment','opacity','order'] as const)channels.push({id:uid(),target:'slot',targetId:s.id,property,keys:[]});
 for(const a of c.attachments){const mesh=a.mesh??c.attachments.find(x=>x.id===a.sourceMeshId)?.mesh;if(mesh)channels.push({id:uid(),target:'attachment',targetId:a.id,property:'deform',meshVersion:mesh.version,keys:[]});}
 if(count>601||count*channels.length+c.constraints.length>20000)throw new Error('Bake exceeds 20000 keys. Reduce FPS, duration or bone count.');
 for(let n=0;n<count;n++){
  const time=Math.min(source.duration,n/fps),pose=evaluateCharacter(c,instance,time);
  for(const channel of channels){
   let value:number|string|number[];
   if(channel.target==='bone')value=pose.bones[channel.targetId][channel.property as 'x'];
   else if(channel.target==='slot')value=pose.slots[channel.targetId][channel.property as 'opacity'];
   else {const a=c.attachments.find(a=>a.id===channel.targetId)!,mesh=a.mesh??c.attachments.find(x=>x.id===a.sourceMeshId)!.mesh!;value=pose.deform[a.id]??Array(mesh.vertices.length*2).fill(0);}
   channel.keys.push({id:uid(),time,value,easing:channel.property==='attachment'||channel.property==='order'?'step':'linear'});
  }
 }
 // Store the entire evaluated pose, including slider-driven slots and deformation.
 for(const control of c.constraints)channels.push({id:uid(),target:'constraint',targetId:control.id,property:'mix',keys:[{id:uid(),time:0,value:0}]});
 return {id:clipId,name,duration:source.duration,loop:source.loop,channels,events:source.events.map(e=>({...e,id:uid()})),bakedFrom:{clipId:sourceClipId,fps}};
}

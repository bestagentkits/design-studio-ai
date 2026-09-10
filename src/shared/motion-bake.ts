import {uid} from './schema';
import {characterInstanceSchema,type Character,type MotionClip} from './character-schema';
import {evaluateCharacter} from './character-runtime';
export function bakeMotion(c:Character,sourceClipId:string,clipId:string,name:string,fps:number):MotionClip{
 const source=c.clips.find(x=>x.id===sourceClipId);if(!source)throw new Error('Unknown source clip');
 const count=Math.ceil(source.duration*fps)+1;
 if(count>601||count*c.bones.length*5>20000)throw new Error('Bake exceeds 20000 keys. Reduce FPS, duration or bone count.');
 const instance=characterInstanceSchema.parse({characterId:c.id,clipId:sourceClipId}),channels:MotionClip['channels']=[];
 for(const b of c.bones)for(const property of ['x','y','rotation','scaleX','scaleY'] as const)channels.push({id:uid(),target:'bone',targetId:b.id,property,keys:[]});
 for(let n=0;n<count;n++){const time=Math.min(source.duration,n/fps),pose=evaluateCharacter(c,instance,time);for(const channel of channels)channel.keys.push({id:uid(),time,value:pose.bones[channel.targetId][channel.property as 'x'],easing:'linear'});}
 for(const control of c.constraints)channels.push({id:uid(),target:'constraint',targetId:control.id,property:'mix',keys:[{id:uid(),time:0,value:0}]});
 // Slot/deformation channels already carry authored values; preserve them without resampling.
 for(const ch of source.channels.filter(x=>x.target==='slot'||x.target==='attachment'))channels.push({...structuredClone(ch),id:uid(),keys:ch.keys.map(k=>({...structuredClone(k),id:uid()}))});
 return {id:clipId,name,duration:source.duration,loop:source.loop,channels,events:source.events.map(e=>({...e,id:uid()})),bakedFrom:{clipId:sourceClipId,fps}};
}

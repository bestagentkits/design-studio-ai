import { ease } from './easing';
import type { Character, CharacterInstance, MotionChannel, MotionClip, BonePose, Constraint } from './character-schema';
export interface CharacterPose {
  bones: Record<string,BonePose>;
  slots: Record<string,{ attachment: string; opacity: number; order: number }>;
  deform: Record<string,number[]>;
  constraints: Constraint[];
}
const sorted = new WeakMap<MotionChannel,MotionChannel['keys']>();
export function sampleChannel(channel: MotionChannel,time:number) {
  let keys=sorted.get(channel); if(!keys) { keys=[...channel.keys].sort((a,b)=>a.time-b.time); sorted.set(channel,keys); }
  if(!keys.length) return undefined;
  let low=0,high=keys.length;
  while(low<high) { const mid=(low+high)>>>1; if(keys[mid].time<=time) low=mid+1; else high=mid; }
  const a=keys[Math.max(0,low-1)], b=keys[Math.min(keys.length-1,low)];
  if(channel.property==='order' || channel.property==='attachment') return a.value;
  const mix=a.time===b.time?0:ease(Math.max(0,Math.min(1,(time-a.time)/(b.time-a.time))),a.easing);
  if(typeof a.value==='number' && typeof b.value==='number') return a.value+(b.value-a.value)*mix;
  if(Array.isArray(a.value) && Array.isArray(b.value)) { const end=b.value; return a.value.map((v,i)=>v+(end[i]-v)*mix); }
  return a.value;
}
export function setupPose(c:Character, i:CharacterInstance):CharacterPose {
  const skin=c.skins.find(s=>s.id===i.skinId);
  return { bones:Object.fromEntries(c.bones.map(b=>[b.id,{x:b.x,y:b.y,rotation:b.rotation,scaleX:b.scaleX,scaleY:b.scaleY}])),
    slots:Object.fromEntries(c.slots.map((s,index)=>[s.id,{attachment:skin?.attachments[s.id]??s.attachmentId??'',opacity:s.opacity,order:index}])),deform:Object.create(null),constraints:c.constraints.map(x=>({...x,target:[...x.target]})) };
}
function maskContains(c:Character,id:string,mask?:string[]):boolean {
  if(!mask) return true;
  let bone=c.bones.find(b=>b.id===id);
  while(bone) { if(mask.includes(bone.id)) return true; bone=c.bones.find(b=>b.id===bone!.parentId); }
  return false;
}
export function applyClip(c:Character, pose:CharacterPose, setup:CharacterPose,clip:MotionClip,time:number,weight=1,additive=false,mask?:string[]) {
  for(const channel of clip.channels) {
    if(channel.muted) continue;
    const slotId=channel.target==='attachment'?c.attachments.find(a=>a.id===channel.targetId)?.slotId:channel.targetId;
    const boneId=channel.target==='bone'?channel.targetId:c.slots.find(s=>s.id===slotId)?.boneId;
    if(mask && (!boneId || !maskContains(c,boneId,mask))) continue;
    const value=sampleChannel(channel,time); if(value===undefined) continue;
    if(channel.target==='attachment' && Array.isArray(value)) { const previous=pose.deform[channel.targetId]??value.map(()=>0); pose.deform[channel.targetId]=value.map((v,j)=>additive?previous[j]+v*weight:previous[j]+(v-previous[j])*weight); continue; }
    let target: Record<string,unknown>|undefined, base:Record<string,unknown>|undefined;
    if(channel.target==='bone') { target=pose.bones[channel.targetId] as unknown as Record<string,unknown>; base=setup.bones[channel.targetId] as unknown as Record<string,unknown>; }
    if(channel.target==='slot') { target=pose.slots[channel.targetId]; base=setup.slots[channel.targetId]; }
    if(channel.target==='constraint') { target=pose.constraints.find(x=>x.id===channel.targetId) as unknown as Record<string,unknown>; base=setup.constraints.find(x=>x.id===channel.targetId) as unknown as Record<string,unknown>; }
    if(!target) continue;
    const p=channel.property;
    if(p==='targetX'||p==='targetY') { const axis=p==='targetX'?0:1, array=target.target as number[]; array[axis]+=(Number(value)-array[axis])*weight; }
    else if(typeof value==='number') { const current=Number(target[p]??0), rest=Number(base?.[p]??0); target[p]=additive?current+(value-rest)*weight:current+(value-current)*weight; }
    else if(weight>=.5) target[p]=value;
  }
}
export function animatedPose(c:Character,i:CharacterInstance,time:number):CharacterPose {
  const setup=setupPose(c,i), pose=setupPose(c,i);
  const active=i.placements.length?i.placements: i.clipId?[{clipId:i.clipId,start:0,end:3600,sourceStart:0,speed:1,loop:c.clips.find(x=>x.id===i.clipId)?.loop??false,weight:1,blend:'override',fadeIn:0,fadeOut:0,mask:undefined}]:[];
  for(const p of active) {
    if(time<p.start || time>p.end) continue;
    const clip=c.clips.find(x=>x.id===p.clipId); if(!clip) continue;
    const local=p.sourceStart+(time-p.start)*p.speed;
    const t=p.loop?local%clip.duration:Math.min(local,clip.duration);
    const weight=p.weight*Math.min(1,p.fadeIn?(time-p.start)/p.fadeIn:1,p.fadeOut?(p.end-time)/p.fadeOut:1);
    applyClip(c,pose,setup,clip,t,weight,p.blend==='additive',p.mask);
  }
  for(const control of pose.constraints.filter(x=>x.type==='slider')) {
    const clip=c.clips.find(x=>x.id===control.clipId);
    const driver=control.targetBoneId?pose.bones[control.targetBoneId]?.[control.sourceProperty]:undefined;
    const value=i.controls?.[control.id]??(driver===undefined?control.value:Math.max(0,Math.min(1,driver*control.factor)));
    if(clip) applyClip(c,pose,setup,clip,value*clip.duration,control.mix,false,control.bones);
  }
  return pose;
}

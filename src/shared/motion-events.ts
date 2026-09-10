import type {Character,CharacterInstance} from './character-schema';
/** Playback uses (from,to]; a seek calls the evaluator without delivering these notifications. */
export function motionEvents(c:Character,instance:CharacterInstance,from:number,to:number){
 const result:{name:string;clipId:string;eventId:string;cycle:number;time:number}[]=[];
 if(to<=from)return result;
 const placements=instance.placements.length?instance.placements:instance.clipId?[{clipId:instance.clipId,start:0,end:3600,sourceStart:0,speed:1,loop:c.clips.find(x=>x.id===instance.clipId)?.loop??false}]:[];
 for(const p of placements){const clip=c.clips.find(x=>x.id===p.clipId);if(!clip)continue;
  const low=Math.max(from,p.start),high=Math.min(to,p.end);if(high<low)continue;
  const first=p.loop?Math.floor((p.sourceStart+(low-p.start)*p.speed)/clip.duration):0,last=p.loop?Math.floor((p.sourceStart+(high-p.start)*p.speed)/clip.duration):0;
  for(let cycle=first;cycle<=last;cycle++)for(const event of clip.events){const at=p.start+(cycle*clip.duration+event.time-p.sourceStart)/p.speed;if(at>from&&at>=p.start&&at<=high)result.push({name:event.name,clipId:clip.id,eventId:event.id,cycle,time:at});if(result.length>=256)return result;}
 }
 return result.sort((a,b)=>a.time-b.time);
}

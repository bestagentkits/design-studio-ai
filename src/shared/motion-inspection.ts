import {z} from 'zod';
import type {DesignDocument} from './schema';
import {characterInstanceSchema} from './character-schema';
import {evaluateCharacter} from './character-runtime';
export const motionInspectionSchema=z.object({characterId:z.string().optional(),nodeId:z.string().optional(),time:z.coerce.number().min(0).max(3600).default(0)});
export function inspectMotion(doc:DesignDocument,input:z.infer<typeof motionInspectionSchema>){
 const node=doc.pages.flatMap(p=>p.nodes).find(n=>n.id===input.nodeId),id=input.characterId??node?.character?.characterId;
 if(input.nodeId&&!node?.character)throw new Error('Unknown character instance');
 if(id&&!doc.characters?.some(c=>c.id===id))throw new Error('Unknown character');
 return {schemaVersion:doc.schemaVersion,characters:(doc.characters??[]).filter(c=>!id||c.id===id).map(c=>({id:c.id,name:c.name,bones:c.bones.map(b=>({id:b.id,name:b.name,parentId:b.parentId})),slots:c.slots.map(s=>({id:s.id,name:s.name,boneId:s.boneId})),clips:c.clips.map(x=>({id:x.id,name:x.name,duration:x.duration,channels:x.channels.length,keys:x.channels.reduce((n,ch)=>n+ch.keys.length,0)})),skins:c.skins.map(s=>({id:s.id,name:s.name})),constraints:c.constraints.map(x=>({id:x.id,name:x.name,type:x.type})),...(id?{pose:evaluateCharacter(c,node?.character??characterInstanceSchema.parse({characterId:c.id}),input.time)}:{}),warnings:c.bones.filter(b=>!b.scaleX||!b.scaleY).map(b=>`Bone ${b.id} has zero setup scale; inverse transforms are unavailable.`)}))};
}

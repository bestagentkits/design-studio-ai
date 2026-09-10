import {bakeMotion} from './motion-bake';
import { z } from 'zod';
import { characterSchema, characterId, boneSchema, slotSchema, attachmentSchema, skinSchema, motionClipSchema, motionChannelSchema, motionKeySchema, constraintSchema } from './character-schema';
import type { DesignDocument } from './schema';
export const characterOperationSchemas = [
  z.object({op:z.literal('bake-character'),characterId,sourceClipId:characterId,clipId:characterId,name:z.string().min(1).max(200),fps:z.number().int().min(1).max(60)}),
  z.object({op:z.literal('upsert-character'),character:characterSchema}),
  z.object({op:z.literal('remove-character'),characterId}),
  z.object({op:z.literal('upsert-bone'),characterId,bone:boneSchema}),
  z.object({op:z.literal('upsert-slot'),characterId,slot:slotSchema}),
  z.object({op:z.literal('upsert-attachment'),characterId,attachment:attachmentSchema}),
  z.object({op:z.literal('upsert-skin'),characterId,skin:skinSchema}),
  z.object({op:z.literal('upsert-clip'),characterId,clip:motionClipSchema}),
  z.object({op:z.literal('upsert-constraint'),characterId,constraint:constraintSchema}),
  z.object({op:z.literal('remove-character-item'),characterId,collection:z.enum(['bones','slots','attachments','skins','clips','constraints']),itemId:characterId}),
  z.object({op:z.literal('upsert-channel'),characterId,clipId:characterId,channel:motionChannelSchema}),
  z.object({op:z.literal('remove-channel'),characterId,clipId:characterId,channelId:characterId}),
  z.object({op:z.literal('upsert-motion-key'),characterId,clipId:characterId,channelId:characterId,key:motionKeySchema}),
  z.object({op:z.literal('remove-motion-key'),characterId,clipId:characterId,channelId:characterId,keyId:characterId}),
] as const;
export const characterOperationSchema=z.discriminatedUnion('op',characterOperationSchemas);
export type CharacterOperation=z.infer<typeof characterOperationSchema>;
const upsert=<T extends {id:string}>(items:T[],item:T)=>{const index=items.findIndex(x=>x.id===item.id);if(index<0)items.push(item);else items[index]=item;};
export function applyCharacterOperation(doc:DesignDocument,action:CharacterOperation) {
  doc.schemaVersion=2; doc.characters??=[];
  if(action.op==='upsert-character') {upsert(doc.characters,action.character);return;}
  const c=doc.characters.find(x=>x.id===action.characterId);if(!c)throw new Error('Unknown character');
  if(action.op==='remove-character') {doc.characters=doc.characters.filter(x=>x!==c);return;}
  if(action.op==='bake-character') {if(c.clips.some(x=>x.id===action.clipId))throw new Error('Choose a new clip ID for the bake');c.clips.push(bakeMotion(c,action.sourceClipId,action.clipId,action.name,action.fps));}
  else if(action.op==='upsert-bone') upsert(c.bones,action.bone);
  else if(action.op==='upsert-slot') upsert(c.slots,action.slot);
  else if(action.op==='upsert-attachment') upsert(c.attachments,action.attachment);
  else if(action.op==='upsert-skin') upsert(c.skins,action.skin);
  else if(action.op==='upsert-clip') upsert(c.clips,action.clip);
  else if(action.op==='upsert-constraint') upsert(c.constraints,action.constraint);
  else if(action.op==='remove-character-item') {
    const index=c[action.collection].findIndex(x=>x.id===action.itemId);if(index<0)throw new Error('Unknown character item');c[action.collection].splice(index,1);
  } else {
    const clip=c.clips.find(x=>x.id===action.clipId);if(!clip)throw new Error('Unknown clip');
    if(action.op==='upsert-channel') upsert(clip.channels,action.channel);
    else {
      const channel=clip.channels.find(x=>x.id===action.channelId);if(!channel)throw new Error('Unknown channel');
      if(action.op==='remove-channel') clip.channels=clip.channels.filter(x=>x!==channel);
      else {
        if(channel.locked)throw new Error('Unlock the channel before editing keys');
        if(action.op==='upsert-motion-key') upsert(channel.keys,action.key);
        else {if(!channel.keys.some(x=>x.id===action.keyId))throw new Error('Unknown key');channel.keys=channel.keys.filter(x=>x.id!==action.keyId);}
      }
    }
  }
}

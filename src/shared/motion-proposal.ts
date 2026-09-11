import {z} from 'zod';
import {characterOperationSchemas} from './character-operations';
import {characterInstanceSchema} from './character-schema';
import {nodeSchema,type DesignDocument} from './schema';
/** Motion proposals can edit rigs and character placements, never unrelated pages or media. */
export const motionProposalSchema=z.array(z.discriminatedUnion('op',[
 ...characterOperationSchemas,
 z.object({op:z.literal('add-node'),pageId:z.string(),node:nodeSchema.extend({type:z.literal('character'),character:characterInstanceSchema})}),
 z.object({op:z.literal('update-node'),nodeId:z.string(),changes:nodeSchema.pick({character:true,x:true,y:true,width:true,height:true,rotation:true,opacity:true}).partial()}),
])).min(1).max(100);
export function motionProposalContext(doc:DesignDocument){return {schemaVersion:doc.schemaVersion,characters:doc.characters??[],assets:doc.assets.filter(a=>(a.mimeType??'').startsWith('image/')).map(({id,name,mimeType})=>({id,name,mimeType})),pages:doc.pages.map(p=>({id:p.id,width:p.width,height:p.height,nodes:p.nodes.filter(n=>n.character).map(({id,name,x,y,width,height,character})=>({id,name,x,y,width,height,character}))}))};}
export function parseMotionProposal(doc:DesignDocument,input:unknown){const operations=motionProposalSchema.parse(input);for(const op of operations)if(op.op==='update-node'&&!doc.pages.some(p=>p.nodes.some(n=>n.id===op.nodeId&&n.character)))throw new Error('Motion proposals can update character instances only');return operations;}

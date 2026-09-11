import {characterSchema} from '../src/shared/character-schema';
import {characterErrors} from '../src/shared/character-validation';
import {automaticWeights} from '../src/shared/character-weights';
self.onmessage=(event:MessageEvent)=>{const {jobId,character,attachmentId}=event.data;try{const c=characterSchema.parse(character),errors=characterErrors(c,new Set(c.attachments.flatMap(a=>[a.assetId,...(a.frames??[])].filter((id):id is string=>!!id))));if(errors.length)throw new Error(errors[0]);self.postMessage({jobId,weights:automaticWeights(c,attachmentId)});}catch(e){self.postMessage({jobId,error:e instanceof Error?e.message:'Weight calculation failed'});}};

import { mutateDocument } from '../src/shared/operations';
self.onmessage = event => {
  try { const {document,pageId,command}=event.data; self.postMessage({document:mutateDocument(document,[{op:'scene-command',pageId,command}])}); }
  catch(error){self.postMessage({error:error instanceof Error?error.message:'Geometry failed'});}
};

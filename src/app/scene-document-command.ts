import type { DesignDocument } from '../shared/schema';
import type { SceneCommand } from '../shared/scene-authoring-schema';
/** Keep geometry work off the UI thread and reject jobs whose caller's state has changed. */
export function sceneDocumentCommand(document:DesignDocument,pageId:string,command:SceneCommand):Promise<DesignDocument>{
  return new Promise((resolve,reject)=>{const worker=new Worker('/studio-scene-worker.js');const timer=setTimeout(()=>{worker.terminate();reject(new Error('Geometry job exceeded 30 seconds. Reduce its resolution.'));},30000);const finish=()=>{clearTimeout(timer);worker.terminate();};worker.onmessage=e=>{finish();if(e.data.error)reject(new Error(e.data.error));else resolve(e.data.document);};worker.onerror=()=>{finish();reject(new Error('Geometry worker failed; design was not changed'));};worker.postMessage({document,pageId,command});});
}

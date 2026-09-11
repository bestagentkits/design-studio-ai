import JSZip from 'jszip';
import {Vector3} from 'three';
import type {DesignDocument} from '../src/shared/schema';
import {defaultScene} from '../src/shared/scene-runtime';
import {captureExportPage} from '../src/app/export-page';
export async function sceneAngles(input:DesignDocument,index:number,time:number){
 const doc=structuredClone(input),page=doc.pages[index];if(!page.nodes.some(n=>n.type==='model3d'))throw new Error('Multi-angle export requires a 3D page');
 if(page.width*page.height*4>67108864)throw new Error('Four angle views exceed 64 megapixels');
 const config=page.scene??defaultScene,target=new Vector3(...config.camera.target),offset=new Vector3(...config.camera.position).sub(target),zip=new JSZip(),views=[];
 for(const [name,angle] of [['front',0],['right',Math.PI/2],['back',Math.PI],['left',-Math.PI/2]] as const){const position=offset.clone().applyAxisAngle(new Vector3(0,1,0),angle).add(target).toArray();page.scene={...config,camera:{...config.camera,position}};const canvas=await captureExportPage(doc,index,time),file=`${name}.png`;zip.file(file,canvas.toDataURL('image/png').split(',')[1],{base64:true});views.push({file,time,camera:page.scene.camera});}
 zip.file('views.json',JSON.stringify({pageId:page.id,reference:'front is the saved camera; other angles orbit its target',views},null,2));return zip.generateAsync({type:'base64',compression:'DEFLATE'});
}

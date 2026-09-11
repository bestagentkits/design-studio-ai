import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from '@playwright/test';
import {build} from 'esbuild';
import JSZip from 'jszip';
import {createDocument} from '../src/shared/catalog';
import {mutateDocument} from '../src/shared/operations';
import {Vector3} from 'three';
import {boneWorld} from '../src/shared/scene-rigging';
import {inspectScene,inspectSceneAnimation} from '../src/shared/scene-inspection';
test('shared character GLB reopens with one skin, authored maps, morphs and solved animation', {timeout:90000},async()=>{
 let doc=createDocument('3d','Shared character');doc.pages[0].width=400;doc.pages[0].height=400;doc.pages[0].nodes=[{id:'body',name:'body',type:'model3d',x:0,y:0,width:400,height:400,scene:{position:[0,0,0],scale:[1,1,1]},data:{geometry:'sphere'}}];const pageId=doc.pages[0].id;
 const run=(command:any)=>{doc=mutateDocument(doc,[{op:'scene-command',pageId,command}]);};
 run({action:'convert',nodeId:'body'});run({action:'rig-quadruped',nodeId:'body'});run({action:'bind',nodeId:'body'});
 doc.pages[0].nodes.push({...structuredClone(doc.pages[0].nodes[0]),id:'eye',name:'eye',scene:{position:[0,.8,0],scale:[.1,.1,.1]}});run({action:'convert',nodeId:'eye'});run({action:'attach',nodeId:'eye',rigNodeId:'body',bone:'head'});run({action:'clip',nodeId:'body',preset:'idle'});run({action:'share-rig',nodeId:'body'});run({action:'edit-clip',nodeId:'body',name:'idle-0',amplitude:.6,speed:1.2,repeat:2,blend:.1});run({action:'morph',nodeId:'eye',name:'blink',vertices:[0,1,2],delta:[0,-.03,0],weight:.4});
 for(const map of ['color','normal','roughness']){run({action:'texture-layer',nodeId:'body',id:map,name:map,map,resolution:256});run({action:'paint',nodeId:'body',layerId:map,uv:[.5,.5],radius:.2,color:map==='normal'?'#8080ff':map==='roughness'?'#999999':'#ffbb88'});}
 const bones=doc.pages[0].nodes[0].scene!.bones!,footIndex=bones.findIndex(b=>b.name==='frontLeftFoot'),target=new Vector3().setFromMatrixPosition(boneWorld(bones)[footIndex]);target.x+=.02;
 run({action:'contact',nodeId:'body',id:'stance',endBone:'frontLeftFoot',target:target.toArray(),pole:target.clone().add(new Vector3(0,1,1)).toArray(),start:0,end:doc.timeline!.duration,maxAngle:180,groundHeight:target.y});
 const expected=inspectScene(doc,pageId,.4).pages[0].nodes[0].bones![footIndex].position;
 const scan=inspectSceneAnimation(doc,pageId,0,doc.timeline!.duration,5);assert.equal(scan.frames.length,5);
 const browser=await chromium.launch({headless:true});try{
  const page=await browser.newPage();await page.setContent('<html><body></body></html>');await page.addScriptTag({content:await readFile('public/studio-renderer.js','utf8')});
  const encoded=await page.evaluate(async doc=>(globalThis as any).studioRenderer.scene(doc,0,'glb'),doc),bytes=Buffer.from(encoded,'base64');assert.equal(bytes.toString('ascii',0,4),'glTF');const json=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString());assert.equal(json.skins.length,1);assert.equal(json.meshes.length,2);assert(json.animations.length===2);assert(json.materials.some((m:any)=>m.normalTexture&&m.pbrMetallicRoughness?.metallicRoughnessTexture&&m.pbrMetallicRoughness?.baseColorTexture));
  const bundle=await build({stdin:{contents:"import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';import {AnimationMixer,Vector3} from 'three';globalThis.check=async (bytes,footIndex)=>{const gltf=await new GLTFLoader().parseAsync(new Uint8Array(bytes).buffer,'');const body=gltf.scene.getObjectByName('body'),eye=gltf.scene.getObjectByName('eye'),mixer=new AnimationMixer(gltf.scene);mixer.clipAction(gltf.animations[0]).play();mixer.setTime(.4);gltf.scene.updateMatrixWorld(true);body.skeleton.update();eye.skeleton.update();return {foot:body.skeleton.bones[footIndex].getWorldPosition(new Vector3()).toArray(),bones:body.skeleton.bones.length,shared:body.skeleton.bones[0]===eye.skeleton.bones[0],morph:eye.morphTargetInfluences[0],normal:!!body.material.normalMap,roughness:!!body.material.roughnessMap,rotated:body.skeleton.bones.some(b=>b.rotation.x!==0)};};",resolveDir:process.cwd()},bundle:true,write:false,format:'iife',platform:'browser'});await page.addScriptTag({content:bundle.outputFiles[0].text});const result=await page.evaluate(async ({bytes,footIndex})=>(globalThis as any).check(bytes,footIndex),{bytes:Array.from(bytes),footIndex});assert(new Vector3(...result.foot).distanceTo(new Vector3(...expected))<.0001);assert(result.shared);assert(result.rotated);assert(result.normal&&result.roughness);assert(Math.abs(result.morph-.4)<1e-5);
  const angles=await page.evaluate(async doc=>(globalThis as any).studioRenderer.sceneAngles(doc,0,.4),doc),zip=await JSZip.loadAsync(Buffer.from(angles,'base64'));for(const name of ['front','right','back','left'])assert((await zip.file(name+'.png')!.async('uint8array')).length>100);assert.equal(JSON.parse(await zip.file('views.json')!.async('string')).views.length,4);
 }finally{await browser.close();}
});

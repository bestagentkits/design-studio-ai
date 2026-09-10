import {useEffect,useMemo,useRef,useState} from 'react';
import * as THREE from 'three';
import type {DesignDocument,DesignNode} from '../shared/schema';
import {buildScene,animateScene,disposeScene} from '../shared/scene-runtime';
/** A scene is a background plane; standalone 3D nodes share the regular DOM layer order. */
export function CharacterSceneLayer({doc,pageIndex,node,time}:{doc:DesignDocument;pageIndex:number;node?:DesignNode;time:number}){
 const host=useRef<HTMLDivElement>(null),draw=useRef<(time:number)=>void>(()=>{}),clock=useRef(time);clock.current=time;
 const [ready,setReady]=useState(false),[error,setError]=useState('');
 const local=useMemo(()=>{if(!node)return doc;const page=doc.pages[pageIndex];return {...doc,pages:[{...page,scene:undefined,width:Math.max(1,node.width),height:Math.max(1,node.height),nodes:[{...node,parentId:undefined,x:0,y:0}]}]};},[doc,pageIndex,node]);
 useEffect(()=>{let disposed=false,cleanup=()=>{};setReady(false);setError('');
 void(async()=>{try{const built=await buildScene(local,node?0:pageIndex,clock.current);if(disposed){disposeScene(built.scene);return;}const el=host.current!;built.scene.background=null;
 const renderer=new THREE.WebGLRenderer({alpha:true,antialias:true,preserveDrawingBuffer:true});el.append(renderer.domElement);renderer.domElement.style.cssText='width:100%;height:100%';
 const paint=(at:number)=>{animateScene(built.scene,local,node?0:pageIndex,at);renderer.render(built.scene,built.camera);};
 const resize=()=>{const page=local.pages[node?0:pageIndex],width=Math.max(1,el.clientWidth||page.width),height=Math.max(1,el.clientHeight||page.height);renderer.setSize(width,height,false);built.camera.aspect=width/height;built.camera.updateProjectionMatrix();paint(clock.current);};const observer=new ResizeObserver(resize);observer.observe(el);resize();draw.current=paint;setReady(true);
 cleanup=()=>{draw.current=()=>{};observer.disconnect();disposeScene(built.scene);renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();};
 }catch(e){if(!disposed)setError(e instanceof Error?e.message:'3D layer could not load');}})();return()=>{disposed=true;cleanup();};},[local,pageIndex,!!node]);
 useEffect(()=>draw.current(time),[time]);
 return <div ref={host} data-character-ready={ready&&!error?'true':'false'} data-character-error={error||undefined} style={{position:'absolute',inset:0}}>{error&&<span role="alert">{error}</span>}</div>;
}

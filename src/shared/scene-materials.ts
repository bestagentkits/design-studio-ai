import * as T from 'three';
import type {DesignNode} from './schema';
export function paintMaterial(material:T.MeshStandardMaterial,config:NonNullable<NonNullable<DesignNode['scene']>['material']>,baseColor:string){
 const resolution=config.textureResolution??512;
 for(const map of ['color','normal','roughness'] as const){
  const layers=config.layers?.filter(l=>l.map===map&&l.visible!==false)??[];
  const legacy=map==='color'?config.paint??[]:[];
  if(!layers.length&&!legacy.length)continue;
  const canvas=document.createElement('canvas');canvas.width=canvas.height=resolution;const ctx=canvas.getContext('2d')!;
  ctx.fillStyle=map==='color'?baseColor:map==='normal'?'#8080ff':`rgb(${Math.round((config.roughness??.5)*255)},${Math.round((config.roughness??.5)*255)},${Math.round((config.roughness??.5)*255)})`;ctx.fillRect(0,0,resolution,resolution);
  for(const layer of [{opacity:1,strokes:legacy},...layers]){const layerCanvas=document.createElement('canvas');layerCanvas.width=layerCanvas.height=resolution;const layerContext=layerCanvas.getContext('2d')!;for(const s of layer.strokes){layerContext.fillStyle=s.color;layerContext.beginPath();layerContext.arc(s.uv[0]*resolution,(1-s.uv[1])*resolution,s.radius*resolution,0,Math.PI*2);layerContext.fill();}ctx.globalAlpha=layer.opacity;ctx.drawImage(layerCanvas,0,0);}
  const texture=new T.CanvasTexture(canvas);texture.colorSpace=map==='color'?T.SRGBColorSpace:T.NoColorSpace;
  if(map==='color'){material.map?.dispose();material.map=texture;material.color.set('#ffffff');}
  if(map==='normal'){material.normalMap?.dispose();material.normalMap=texture;}
  if(map==='roughness'){material.roughnessMap?.dispose();material.roughnessMap=texture;material.roughness=1;}
 }
}

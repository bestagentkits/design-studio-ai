import { useEffect, useState } from 'react';
import type { DesignDocument } from '../shared/schema';
import { message } from './api';
export function CommunityCoverReview({ document: doc, pageIndex, time, focalX, focalY, onReady }: { document: DesignDocument; pageIndex: number; time: number; focalX: number; focalY: number; onReady: (ready: boolean) => void }) {
  const [src,setSrc]=useState(''),[error,setError]=useState('');
  useEffect(()=>{let active=true;let url:string|undefined;setSrc('');setError('');onReady(false);
    void (async()=>{const {mountExportPage,rasterizeExportPage}=await import('./export-page');const index=Math.min(pageIndex,doc.pages.length-1);const mounted=await mountExportPage(doc,index,time,true);try{const canvas=await rasterizeExportPage(mounted.host,doc.pages[index].width,doc.pages[index].height);const cover=document.createElement('canvas');cover.width=480;cover.height=360;const scale=Math.max(480/canvas.width,360/canvas.height),width=480/scale,height=360/scale;const x=Math.max(0,Math.min(canvas.width-width,focalX*canvas.width-width/2)),y=Math.max(0,Math.min(canvas.height-height,focalY*canvas.height-height/2));cover.getContext('2d')!.drawImage(canvas,x,y,width,height,0,0,480,360);const blob=await new Promise<Blob>((resolve,reject)=>cover.toBlob(value=>value?resolve(value):reject(new Error('Could not encode cover review.')),'image/png'));if(active){url=URL.createObjectURL(blob);setSrc(url);onReady(true);}}finally{mounted.dispose();}})().catch(error=>{if(active)setError(message(error));});
    return()=>{active=false;if(url)URL.revokeObjectURL(url);};
  },[doc,pageIndex,time,focalX,focalY,onReady]);
  return <div style={{minHeight:190}}>{src?<img className="community-projected-cover" src={src} alt="Projected public design review" style={{objectPosition:`${focalX*100}% ${focalY*100}%`}}/>:<p role={error?'alert':'status'}>{error||'Rendering your public cover review…'}</p>}</div>;
}

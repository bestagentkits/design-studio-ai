import JSZip from 'jszip';
import type {DesignDocument} from '../src/shared/schema';
import {captureExportPage} from '../src/app/export-page';
export async function motionFrames(doc:DesignDocument,index:number,format:string,start:number,end:number,fps:number){
 const page=doc.pages[index],count=Math.ceil((end-start)*fps);
 if(count<1||count>300||page.width*page.height*count>67108864)throw new Error('Frame export exceeds 300 frames or 64 megapixels. Shorten the range or reduce dimensions.');
 const zip=new JSZip(),columns=Math.ceil(Math.sqrt(count)),rows=Math.ceil(count/columns);
 const sheet=document.createElement('canvas');if(format==='spritesheet'){sheet.width=columns*page.width;sheet.height=rows*page.height;if(sheet.width>16384||sheet.height>16384)throw new Error('Spritesheet exceeds 16384 pixels per side.');}
 const entries=[];
 for(let n=0;n<count;n++){
  const time=start+n/fps,canvas=await captureExportPage(doc,index,time),name=`frame-${String(n).padStart(5,'0')}.png`;
  if(format==='spritesheet')sheet.getContext('2d')!.drawImage(canvas,n%columns*page.width,Math.floor(n/columns)*page.height);
  else zip.file(name,canvas.toDataURL('image/png').split(',')[1],{base64:true});
  entries.push({name,time,x:format==='spritesheet'?n%columns*page.width:0,y:format==='spritesheet'?Math.floor(n/columns)*page.height:0,width:page.width,height:page.height});
 }
 if(format==='spritesheet')zip.file('spritesheet.png',sheet.toDataURL('image/png').split(',')[1],{base64:true});
 zip.file('frames.json',JSON.stringify({format,fps,start,end,loopEndpoint:'exclusive',frames:entries},null,2));
 return zip.generateAsync({type:'base64',compression:'DEFLATE'});
}

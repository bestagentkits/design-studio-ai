import {documentSchema} from './schema';
const limit=32*1024*1024;
/** Read only native JSON entries. Never evaluate a package's HTML or player script. */
export async function readMotionArchive(bytes:Uint8Array){
 if(bytes.length>limit||bytes.length<22)throw new Error('Motion package must be a ZIP under 32 MiB');
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),decoder=new TextDecoder('utf-8',{fatal:true});let end=-1;
 for(let p=bytes.length-22;p>=Math.max(0,bytes.length-65557);p--)if(view.getUint32(p,true)===0x06054b50){end=p;break;}
 if(end<0||view.getUint16(end+4,true)||view.getUint16(end+6,true))throw new Error('Unsupported ZIP directory');
 const count=view.getUint16(end+10,true),size=view.getUint32(end+12,true);let cursor=view.getUint32(end+16,true),total=0;
 if(count>16||cursor+size>end)throw new Error('Motion package directory exceeds limits');
 const names=new Set<string>(),json=new Map<string,string>();
 for(let n=0;n<count;n++){
  if(cursor+46>end||view.getUint32(cursor,true)!==0x02014b50)throw new Error('Invalid ZIP entry');
  const flags=view.getUint16(cursor+8,true),method=view.getUint16(cursor+10,true),compressed=view.getUint32(cursor+20,true),expanded=view.getUint32(cursor+24,true),length=view.getUint16(cursor+28,true),extra=view.getUint16(cursor+30,true),comment=view.getUint16(cursor+32,true),offset=view.getUint32(cursor+42,true);
  if(cursor+46+length+extra+comment>end)throw new Error('Truncated ZIP directory');
  const name=decoder.decode(bytes.subarray(cursor+46,cursor+46+length));cursor+=46+length+extra+comment;total+=expanded;
  if(!/^[a-zA-Z0-9._-]+$/.test(name)||name==='.'||name==='..'||names.has(name)||flags&1||total>64*1024*1024||expanded>limit)throw new Error('Unsafe or oversized ZIP entry');names.add(name);
  if(name!=='document.json'&&name!=='manifest.json')continue;
  if(offset+30>bytes.length||view.getUint32(offset,true)!==0x04034b50)throw new Error('Invalid ZIP local entry');
  const start=offset+30+view.getUint16(offset+26,true)+view.getUint16(offset+28,true);
  if(start+compressed>bytes.length)throw new Error('Truncated ZIP data');
  const payload=bytes.slice(start,start+compressed);let output:Uint8Array;
  if(method===0)output=payload;
  else if(method===8){
   if(typeof DecompressionStream==='undefined')throw new Error('This browser cannot import compressed packages. Import document.json instead.');
   const stream=new Blob([payload]).stream().pipeThrough(new DecompressionStream('deflate-raw')),reader=stream.getReader(),chunks:Uint8Array[]=[];let size=0;
   try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>expanded||size>limit)throw new Error('Expanded ZIP entry exceeds its declared size');chunks.push(value);}}finally{await reader.cancel();}
   output=new Uint8Array(size);let at=0;for(const chunk of chunks){output.set(chunk,at);at+=chunk.length;}
  }else throw new Error('Unsupported ZIP compression');
  if(output.length!==expanded)throw new Error('ZIP entry size mismatch');json.set(name,decoder.decode(output));
 }
 const manifest=JSON.parse(json.get('manifest.json')??'null');
 if(manifest?.format!=='design-studio-motion'||manifest.version!==1||manifest.document!=='document.json')throw new Error('Not a native Studio motion package');
 const doc=documentSchema.parse(JSON.parse(json.get('document.json')??'null'));
 if(!doc.characters?.length||doc.assets.some(a=>!a.url.startsWith('data:image/')))throw new Error('Motion import requires characters and embedded image assets only');
 return doc;
}

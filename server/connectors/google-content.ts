import { getResolvedPDFJS } from 'unpdf';
import { ApiError,fail } from '../security';
/** Parse private PDF bytes only; scripts, remote fonts, images and document links are never loaded. */
export async function extractSourcePdf(bytes:Uint8Array){
  if(bytes.byteLength>2097152)fail(413,'limit_exceeded','PDF source extraction supports up to 2 MiB.');
  const started=Date.now(),pdfjs=await getResolvedPDFJS();
  const task=pdfjs.getDocument({data:new Uint8Array(bytes),useSystemFonts:false,disableFontFace:true,useWasm:false,useWorkerFetch:false,stopAtErrors:true,verbosity:0});
  const timer=setTimeout(()=>void task.destroy(),5000);
  try{
    const document=await task.promise;
    if(document.numPages>20)fail(413,'limit_exceeded','PDF source extraction supports up to 20 pages.');
    if(await document.getPermissions()!==null)fail(422,'unsupported_content','Encrypted PDFs are not supported. Export an unencrypted text copy.');
    const pages:string[]=[];let size=0;
    for(let index=1;index<=document.numPages;index++){
      if(Date.now()-started>5000)fail(408,'connector_timeout','PDF extraction exceeded its deadline.');
      const page=await document.getPage(index),content=await page.getTextContent();
      const text=content.items.map(item=>'str' in item?item.str+('hasEOL' in item&&item.hasEOL?'\n':' '):'').join('').trim();
      size+=new TextEncoder().encode(text).byteLength;
      if(size>262144)fail(413,'limit_exceeded','Extracted PDF text exceeds 256 KiB.');
      pages.push(text);page.cleanup();
    }
    if(!pages.some(text=>text.trim()))fail(422,'unsupported_content','This PDF has no extractable text. Scanned documents require manual transcription; OCR is not performed.');
    return new TextEncoder().encode(pages.join('\n\n'));
  }catch(error){if(error instanceof ApiError)throw error;fail(422,'unsupported_content','This PDF could not be read. Use a text-based, unencrypted PDF or upload text.');}
  finally{clearTimeout(timer);await task.destroy();}
}

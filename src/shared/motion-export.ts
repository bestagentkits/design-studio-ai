import JSZip from 'jszip';
import type {DesignDocument} from './schema';
import {renderHtml} from './render';
export async function createMotionArchive(doc:DesignDocument,player:string){
 const zip=new JSZip();
 if(doc.assets.some(a=>!a.url.startsWith('data:')))throw new Error('Import external assets before creating a portable package.');
 zip.file('document.json',JSON.stringify(doc,null,2));zip.file('player.js',player);
 zip.file('index.html',renderHtml(doc,{script:player}));
 zip.file('manifest.json',JSON.stringify({format:'design-studio-motion',version:1,document:'document.json',player:'player.js',schemaVersion:doc.schemaVersion,characters:doc.characters?.map(c=>({id:c.id,name:c.name,clips:c.clips.map(x=>({id:x.id,name:x.name,duration:x.duration})),skins:c.skins.map(x=>({id:x.id,name:x.name}))}))??[]},null,2));
 zip.file('README.md','# Native Studio motion package\n\nOpen index.html in a browser. Artwork is embedded; no account or provider credentials are required. document.json is the editable native document. player.js is the bundled Studio viewer. Import the document into Studio to edit bones, skins, clips and placements. This is not a Spine or game-engine interchange format.\n');
 return zip.generateAsync({type:'uint8array',compression:'DEFLATE'});
}

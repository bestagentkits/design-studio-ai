import {useState} from 'react';
import {uid,type AssetRef} from '../shared/schema';
import {boneSchema,type Character,type BonePose} from '../shared/character-schema';
import {reparentBone,addCharacterLayer} from '../shared/character-editing';
export function CharacterRigPanel({c,boneId,select,edit,assets,pose,poseChange,animate}:{c:Character;boneId:string;select:(id:string)=>void;edit:(fn:(c:Character)=>void)=>void;assets:AssetRef[];pose?:BonePose;poseChange:(p:Partial<BonePose>)=>void;animate:boolean}){
 const [manifest,setManifest]=useState('[]'),[keep,setKeep]=useState(true),[asset,setAsset]=useState('');const bone=c.bones.find(b=>b.id===boneId)??c.bones[0];
 return <section aria-label="Rig properties">
  <label>Bone<select value={bone.id} onChange={e=>select(e.target.value)}>{c.bones.map(b=><option key={b.id} value={b.id}>{b.parentId?'↳ ':''}{b.name}</option>)}</select></label>
  {!animate&&<><button onClick={()=>{const id=uid();edit(c=>c.bones.push(boneSchema.parse({id,name:'Bone',parentId:bone.id,x:bone.length})));select(id);}}>Add child bone</button>
  <label>Name<input value={bone.name} onChange={e=>edit(c=>{c.bones.find(b=>b.id===bone.id)!.name=e.target.value;})}/></label>
  <label>Parent<select value={bone.parentId??''} onChange={e=>edit(c=>reparentBone(c,bone.id,e.target.value||undefined,keep))}><option value="">None</option>{c.bones.filter(b=>b.id!==bone.id).map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
  <label><input type="checkbox" checked={keep} onChange={e=>setKeep(e.target.checked)}/>Keep world pose</label></>}
  {(['x','y','rotation','scaleX','scaleY'] as const).map(p=><label key={p}>{p}<input aria-label={`Bone ${p}`} type="number" step={p.startsWith('scale')?.1:1} value={(pose??bone)[p]} onChange={e=>{const value=e.target.valueAsNumber;if(Number.isFinite(value)){if(animate)poseChange({[p]:value});else edit(c=>{c.bones.find(b=>b.id===bone.id)![p]=value;});}}}/></label>)}
  {!animate&&<><label>Length<input type="number" min="0" value={bone.length} onChange={e=>edit(c=>{c.bones.find(b=>b.id===bone.id)!.length=e.target.valueAsNumber;})}/></label>
  <button disabled={c.bones.length===1} onClick={()=>edit(c=>{if(c.bones.some(b=>b.parentId===bone.id)||c.slots.some(s=>s.boneId===bone.id)||c.constraints.some(x=>x.bones.includes(bone.id)||x.targetBoneId===bone.id)||c.clips.some(x=>x.channels.some(ch=>ch.targetId===bone.id)))throw new Error('Reassign child bones, slots, constraints and animation channels before removing this bone.');c.bones=c.bones.filter(b=>b.id!==bone.id);})}>Remove unused bone</button>
  <label>Existing image<select value={asset} onChange={e=>setAsset(e.target.value)}><option value="">Choose image</option>{assets.filter(a=>a.mimeType.startsWith('image/')).map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
  <button disabled={!asset} onClick={()=>edit(c=>addCharacterLayer(c,asset,assets.find(a=>a.id===asset)!.name,128,128))}>Attach image as layer</button>
  <details><summary>Apply layer manifest</summary><p>JSON array with name matching an imported image, x/y offsets, optional width/height/pivot.</p><textarea aria-label="Layer manifest JSON" value={manifest} onChange={e=>setManifest(e.target.value)}/><button onClick={()=>edit(c=>{const layers=JSON.parse(manifest);if(!Array.isArray(layers)||layers.length>512)throw new Error('Expected up to 512 layer records');for(const layer of layers){const attachment=c.attachments.find(a=>a.name===layer.name);if(!attachment)throw new Error(`Import image ${layer.name} first`);const slot=c.slots.find(s=>s.id===attachment.slotId)!,b=c.bones.find(b=>b.id===slot.boneId)!;if(layer.x!==undefined)b.x=layer.x;if(layer.y!==undefined)b.y=layer.y;if(layer.width!==undefined)attachment.width=layer.width;if(layer.height!==undefined)attachment.height=layer.height;if(layer.pivot!==undefined)attachment.pivot=layer.pivot;}})}>Apply manifest</button></details>
  <p>Layer offsets are relative to the root. Reposition cropped images before animating.</p></>}
 </section>;
}

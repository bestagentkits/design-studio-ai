import {useState} from 'react';
import type {DesignNode} from '../shared/schema';
import type {SceneCommand} from '../shared/scene-authoring-schema';
export function SceneClipEditor({node,run,onRest,onResume}:{node:DesignNode;run:(command:SceneCommand)=>void;onRest:()=>void;onResume:()=>void}){
 const [name,setName]=useState(''),[speed,setSpeed]=useState(1),[amplitude,setAmplitude]=useState(1),[repeat,setRepeat]=useState(1),[blend,setBlend]=useState(0);
 const clips=node.scene?.clips??[];
 const choose=(value:string)=>{setName(value);const clip=clips.find(c=>c.name===value);setSpeed(clip?.speed??1);setAmplitude(clip?.amplitude??1);setRepeat(clip?.repeat??1);setBlend(clip?.blend??0);};
 return <fieldset><legend>Named motion clips</legend><label>Clip<select aria-label="Motion clip" value={name} onChange={e=>choose(e.target.value)}><option value="">Select clip</option>{clips.map(c=><option key={c.name}>{c.name}</option>)}</select></label>
 <label>Speed<input aria-label="Clip speed" type="number" min={.1} max={4} step={.1} value={speed} onChange={e=>setSpeed(+e.target.value)}/></label>
 <label>Amplitude<input aria-label="Clip amplitude" type="range" min={0} max={2} step={.05} value={amplitude} onChange={e=>setAmplitude(+e.target.value)}/><span>{amplitude.toFixed(2)}</span></label>
 <label>Loop count<input aria-label="Clip loops" type="number" min={1} max={20} value={repeat} onChange={e=>setRepeat(+e.target.value)}/></label>
 <label>Blend in/out (seconds)<input aria-label="Clip blend" type="number" min={0} max={5} step={.1} value={blend} onChange={e=>setBlend(+e.target.value)}/></label>
 <button disabled={!name} onClick={()=>run({action:'edit-clip',nodeId:node.id,name,speed,amplitude,repeat,blend})}>Apply clip settings</button><button onClick={()=>{run({action:'rest-pose',nodeId:node.id});onRest();}}>Restore rest pose</button><button onClick={onResume}>Resume animation preview</button><p>Scrub the timeline to preview. Outside clip ranges, the stored pose applies. Later tracks blend over earlier tracks.</p>
 </fieldset>;
}

import {motionEvents} from '../shared/motion-events';
import {useEffect,useRef,useState} from 'react';
import type {Character,CharacterInstance} from '../shared/character-schema';
import {CharacterWebGL} from '../shared/character-webgl';
import {drawCharacter} from '../shared/character-canvas';
export function CharacterView({character,instance,assets,time,playback=false}:{character:Character;instance:CharacterInstance;assets:{id:string;url:string}[];time:number;playback?:boolean}) {
 const [interactionTime,setInteractionTime]=useState(0),previous=useRef(0);
 const canvas=useRef<HTMLCanvasElement>(null),renderer=useRef<CharacterWebGL|null>(null),images=useRef(new Map<string,HTMLImageElement>());
 const [loaded,setLoaded]=useState(0),[error,setError]=useState(''),[ready,setReady]=useState(false),[fallback,setFallback]=useState(false),[trigger,setTrigger]=useState<{clipId:string;at:number}|null>(null);
 const canvasOnly=fallback||character.slots.some(s=>s.blend==='multiply');
 useEffect(()=>{if(!trigger)return;let frame=0;const start=performance.now();const clip=character.clips.find(c=>c.id===trigger.clipId);const tick=(now:number)=>{const elapsed=(now-start)/1000;setInteractionTime(clip&&!clip.loop?Math.min(elapsed,clip.duration):elapsed);if(!clip||clip.loop||elapsed<clip.duration)frame=requestAnimationFrame(tick);};frame=requestAnimationFrame(tick);return()=>cancelAnimationFrame(frame);},[trigger,character.clips]);
 useEffect(()=>{if(playback||trigger){const now=trigger?interactionTime:time;for(const event of motionEvents(character,trigger?{...instance,placements:[],clipId:trigger.clipId}:instance,previous.current,now))canvas.current?.dispatchEvent(new CustomEvent('studio-motion-event',{bubbles:true,detail:event}));previous.current=now;}else previous.current=time;},[playback,trigger,interactionTime,time,character,instance]);
 useEffect(()=>{let active=true;setError('');setReady(false);images.current.clear();Promise.all(assets.filter(a=>character.attachments.some(x=>x.assetId===a.id||x.frames?.includes(a.id))).map(async asset=>{const image=new Image();image.crossOrigin='anonymous';image.src=asset.url;await image.decode();if(active)images.current.set(asset.id,image);})).then(()=>{if(active){setReady(true);setLoaded(x=>x+1);}},()=>{if(active)setError('An image could not load. Check the asset URL and cross-origin access.');});return()=>{active=false;};},[assets,character.attachments]);
 useEffect(()=>{const node=canvas.current;if(!node)return;
   const lost=(event:Event)=>{event.preventDefault();setFallback(true);};node.addEventListener('webglcontextlost',lost);
   if(!canvasOnly)try{renderer.current=new CharacterWebGL(node);}catch{setFallback(true);}
   return()=>{node.removeEventListener('webglcontextlost',lost);renderer.current?.dispose();renderer.current=null;};
 },[canvasOnly]);
 useEffect(()=>{const node=canvas.current;if(!node)return;try{
   const active=trigger?{...instance,placements:[],clipId:trigger.clipId}:instance,at=trigger?interactionTime:time;
   if(renderer.current)renderer.current.render(character,active,images.current,at);
   else if(canvasOnly){const ctx=node.getContext('2d');if(ctx){ctx.clearRect(0,0,node.width,node.height);ctx.save();ctx.scale(node.width/character.width,node.height/character.height);drawCharacter(ctx,character,active,images.current,at);ctx.restore();}}
 }catch(e){setError(e instanceof Error?e.message:'Unable to render character');}},[character,instance,time,loaded,canvasOnly,trigger,interactionTime]);
 const interact=(kind:'click'|'hover')=>{if(kind==='hover'&&window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;const action=instance.interactions.find(x=>x.trigger===kind);if(action){previous.current=0;setInteractionTime(0);setTrigger({clipId:action.clipId,at:performance.now()});}};
 return <div data-character-ready={ready&&!error?'true':'false'} data-character-error={error||undefined} style={{width:'100%',height:'100%'}} onClick={()=>interact('click')} onMouseEnter={()=>interact('hover')}>
  <canvas key={canvasOnly?'canvas':'gpu'} ref={canvas} width={Math.min(2048,character.width)} height={Math.min(2048,character.height)} aria-label={character.name} style={{width:'100%',height:'100%'}}/>
  {error&&<span role="alert">{error}</span>}
 </div>;
}

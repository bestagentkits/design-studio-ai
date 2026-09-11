import type { DesignDocument, DesignNode } from './schema';
import type { SceneCommand } from './scene-authoring-schema';
export function editSceneClip(doc:DesignDocument,node:DesignNode,command:Extract<SceneCommand,{action:'edit-clip'}>){
  const clip=node.scene?.clips?.find(c=>c.name===command.name);
  if(!clip||!doc.timeline)throw new Error('Select an existing named clip');
  const oldStart=clip.start,oldEnd=clip.end;
  const targets=doc.pages.flatMap(p=>p.nodes).filter(n=>n.id===node.id||n.data?.rigSourceId===node.id);
  for(const target of targets)for(const track of doc.timeline.tracks.filter(t=>t.nodeId===target.id)){
    if(track.clipName===clip.name)continue;
    // Legacy presets had one complete track per clip. Reject ambiguous mixed tracks.
    if(!track.clipName&&track.keyframes.length&&track.keyframes.every(k=>k.time>=oldStart&&k.time<=oldEnd)&&track.keyframes.some(k=>Object.keys(k.values).some(key=>key.startsWith('scene.bones.'))))track.clipName=clip.name;
  }
  if(!doc.timeline.tracks.some(t=>t.nodeId===node.id&&t.clipName===clip.name))throw new Error('No isolated animation track matches this clip');
  clip.sourceDuration??=clip.end-clip.start;
  Object.assign(clip,{speed:command.speed,amplitude:command.amplitude,repeat:command.repeat,blend:command.blend});
  clip.end=clip.start+clip.sourceDuration/command.speed*command.repeat;
  if(clip.end>3600)throw new Error('Clip exceeds timeline duration limit');
  doc.timeline.duration=Math.max(doc.timeline.duration,clip.end);
}
export function restoreRigPose(node:DesignNode){for(const bone of node.scene?.bones??[])bone.rotation=[...(bone.bindRotation??[0,0,0])];}

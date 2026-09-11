import {constrainPose} from './scene-constraints';
import {Matrix4,Vector3,Quaternion,Euler} from 'three';
import type { DesignDocument, DesignNode } from './schema';
import { interpolateNode } from './render';

export function rigOwner(node: DesignNode, doc: DesignDocument): DesignNode {
  if (!node.scene?.rigId) return node;
  const page = doc.pages.find(p => p.nodes.some(n => n.id === node.id));
  const source = page?.nodes.find(n => n.id === node.scene!.rigId);
  if (!source?.scene?.bones?.length || source.scene.rigId) throw new Error('Shared rig must reference a skeleton on this page');
  return source;
}
export function scenePose(node: DesignNode, doc: DesignDocument, time: number): DesignNode {
  const pose = interpolateNode(node, doc, time), source = rigOwner(node, doc);
  if (source === node) {constrainPose(pose,doc.pages.find(p=>p.nodes.some(n=>n.id===node.id))!,time);return pose;}
  return { ...pose, scene: { ...pose.scene, bones: scenePose(source, doc, time).scene?.bones } };
}
/** Explicit conversion rejects divergent bone tracks instead of changing legacy animation. */
export function shareRig(doc: DesignDocument, pageId: string, nodeId: string) {
  const page = doc.pages.find(p => p.id === pageId)!;
  const source = page.nodes.find(n => n.id === nodeId);
  if (!source?.scene?.bones?.length || source.scene.rigId) throw new Error('Select a skeleton owner');
  const boneKeys = (id: string) => (doc.timeline?.tracks ?? []).filter(t => t.nodeId === id && !t.muted).map(t => t.keyframes.map(k => ({ ...k, values: Object.fromEntries(Object.entries(k.values).filter(([key]) => key.startsWith('scene.bones.'))) }))).filter(keys => keys.some(k => Object.keys(k.values).length));
  const sourceKeys = JSON.stringify(boneKeys(nodeId));
  if(source.scene.constraints?.some(c=>c.enabled)&&page.nodes.some(n=>n.data?.rigSourceId===nodeId&&!n.scene?.rigId))throw new Error('Share the legacy rig before enabling persistent contacts; copied attachments do not share its solver');
  const matrix=(n:DesignNode)=>new Matrix4().compose(new Vector3(...(n.scene?.position??[(n.x+n.width/2-page.width/2)/240,(page.height/2-n.y-n.height/2)/240,Number(n.data?.z??0)])),new Quaternion().setFromEuler(new Euler(...(n.scene?.rotation??[0,0,0]).map(v=>v*Math.PI/180) as [number,number,number])),new Vector3(...(n.scene?.scale??[n.width/400,n.height/400,Number(n.data?.depth??n.width)/400]))).elements;
  const transform=matrix(source);
  for (const child of page.nodes.filter(n => n.data?.rigSourceId === nodeId && !n.scene?.rigId)) {
    if (child.parentId !== source.parentId || JSON.stringify(child.scene?.bones) !== JSON.stringify(source.scene.bones) || matrix(child).some((v,i)=>Math.abs(v-transform[i])>1e-9) || JSON.stringify(boneKeys(child.id)) !== sourceKeys) throw new Error(`Attachment ${child.id} has a different bind space or animation; align it before sharing`);
    child.scene!.rigId = nodeId;
    delete child.scene!.bones;
    if (doc.timeline) doc.timeline.tracks = doc.timeline.tracks.flatMap(t => t.nodeId !== child.id ? [t] : (() => {
      const keyframes = t.keyframes.map(k => ({ ...k, values: Object.fromEntries(Object.entries(k.values).filter(([key]) => !key.startsWith('scene.bones.'))) })).filter(k => Object.keys(k.values).length);
      return keyframes.length ? [{ ...t, keyframes }] : [];
    })());
  }
}

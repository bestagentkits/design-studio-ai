import {Matrix4,Vector3,Quaternion,Euler} from 'three';
import type {DesignNode,DesignPage} from './schema';
import {boneWorld} from './scene-rigging';
export function nodeMatrix(node:DesignNode,page:DesignPage){return new Matrix4().compose(new Vector3(...(node.scene?.position??[(node.x+node.width/2-page.width/2)/240,(page.height/2-node.y-node.height/2)/240,Number(node.data?.z??0)])),new Quaternion().setFromEuler(new Euler(...(node.scene?.rotation??[0,0,0]).map(v=>v*Math.PI/180) as [number,number,number])),new Vector3(...(node.scene?.scale??[node.width/400,node.height/400,Number(node.data?.depth??node.width)/400])));}
/** Two-bone world-space target with an explicit bend plane; pose data remains local. */
export function constrainPose(pose:DesignNode,page:DesignPage,time:number){
 const bones=pose.scene?.bones;if(!bones)return;
 for(const c of pose.scene?.constraints??[]){if(!c.enabled||time<c.start||time>c.end)continue;
  const end:number=bones.findIndex(b=>b.name===c.endBone),mid=bones[end]?.parent,root=bones[mid]?.parent;if(end<0||mid<0||root<0)throw new Error('Contact needs a two-bone chain');
  const transform=nodeMatrix(pose,page);if(Math.abs(transform.determinant())<1e-12)throw new Error('Contact transform is singular');const inverse=transform.clone().invert();
  const target=new Vector3(...c.target);if(c.groundHeight!==undefined)target.y=c.groundHeight;
  target.applyMatrix4(inverse);const pole=new Vector3(...c.pole).applyMatrix4(inverse);
  const world=boneWorld(bones),a=new Vector3().setFromMatrixPosition(world[root]),b=new Vector3().setFromMatrixPosition(world[mid]),tip=new Vector3().setFromMatrixPosition(world[end]);
  const l1=a.distanceTo(b),l2=b.distanceTo(tip);if(l1<1e-8||l2<1e-8)throw new Error('Contact bones need nonzero lengths');
  const direction=target.clone().sub(a),d=Math.max(1e-7,Math.min(direction.length(),l1+l2-1e-7));if(direction.lengthSq()<1e-14)direction.copy(tip).sub(a);if(direction.lengthSq()<1e-14)direction.set(0,-1,0);direction.normalize();
  const bend=pole.sub(a);bend.addScaledVector(direction,-bend.dot(direction));
  // Derive a stable perpendicular if the pole lies on the target axis.
  if(bend.lengthSq()<1e-10)bend.crossVectors(direction,Math.abs(direction.y)<.9?new Vector3(0,1,0):new Vector3(1,0,0));bend.normalize();
  const x=(l1*l1-l2*l2+d*d)/(2*d),height=Math.sqrt(Math.max(0,l1*l1-x*x)),knee=a.clone().addScaledVector(direction,x).addScaledVector(bend,height);
  const rotate=(joint:number,child:number,to:Vector3)=>{const w=boneWorld(bones),origin=new Vector3().setFromMatrixPosition(w[joint]),from=new Vector3().setFromMatrixPosition(w[child]).sub(origin).normalize(),goal=to.clone().sub(origin).normalize(),delta=new Quaternion().setFromUnitVectors(from,goal),parent=bones[joint].parent,pq=parent<0?new Quaternion():new Quaternion().setFromRotationMatrix(w[parent]),q=pq.invert().multiply(delta).multiply(new Quaternion().setFromRotationMatrix(w[joint])),e=new Euler().setFromQuaternion(q);bones[joint].rotation=[e.x,e.y,e.z].map(v=>Math.max(-c.maxAngle,Math.min(c.maxAngle,v*180/Math.PI))) as [number,number,number];};
  rotate(root,mid,knee);rotate(mid,end,target);
 }
}

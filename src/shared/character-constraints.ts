import type { Character, Point } from './character-schema';
import type { CharacterPose } from './motion-channels';
import { bezierPoint, degrees, identity, inverse, point, shortestAngle, worldMatrices } from './character-math';

export function solveConstraints(c:Character,pose:CharacterPose) {
  // A target must be evaluated before dependent bones, independent of UI order.
  const rank=new Map<string,number>();
  const depth=(id:string):number=>{
    if(rank.has(id)) return rank.get(id)!;
    const parent=c.bones.find(b=>b.id===id)?.parentId;
    const targets=pose.constraints.filter(x=>x.bones.includes(id)&&x.targetBoneId).map(x=>x.targetBoneId!);
    const n=1+Math.max(0,...[...(parent?[parent]:[]),...targets].map(depth)); rank.set(id,n); return n;
  };
  const constraints=[...pose.constraints].sort((a,b)=>Math.max(...a.bones.map(depth))-Math.max(...b.bones.map(depth)));
  for(const control of constraints) {
    if(!control.mix || control.type==='slider'||control.type==='physics') continue;
    const world=worldMatrices(c.bones,pose.bones), target=control.targetBoneId?point(world[control.targetBoneId],[0,0]):control.target;
    const turn=(id:string,angle:number)=>{ const b=c.bones.find(b=>b.id===id)!; const current=worldMatrices(c.bones,pose.bones);const parent=b.parentId?current[b.parentId]:identity(); const local=angle-degrees(Math.atan2(parent[1],parent[0])); pose.bones[id].rotation+=shortestAngle(pose.bones[id].rotation,local)*control.mix; };
    if(control.type==='ik') {
      const before=Object.fromEntries(control.bones.map(id=>[id,{...pose.bones[id]}]));
      if(control.bones.length===2) pose.bones[control.bones[1]].rotation=control.bend==='positive'?90:-90;
      // Bounded CCD also handles non-uniform parent scales without assuming equal limb lengths.
      for(let iteration=0;iteration<24;iteration++) {
        for(const id of [...control.bones].reverse()) {
          const matrices=worldMatrices(c.bones,pose.bones), last=c.bones.find(b=>b.id===control.bones.at(-1))!;
          const origin=point(matrices[id],[0,0]), end=point(matrices[last.id],[last.length,0]);
          const a=Math.atan2(end[1]-origin[1],end[0]-origin[0]), b=Math.atan2(target[1]-origin[1],target[0]-origin[0]);
          const parent=c.bones.find(b=>b.id===id)?.parentId, matrix=parent?matrices[parent]:identity();
          const sign=matrix[0]*matrix[3]-matrix[1]*matrix[2]<0?-1:1;
          pose.bones[id].rotation+=shortestAngle(degrees(a),degrees(b))*sign;
        }
      }
      if(control.stretch) { const root=control.bones[0], m=worldMatrices(c.bones,pose.bones)[root], length=control.bones.reduce((s,id)=>s+c.bones.find(b=>b.id===id)!.length,0); const ratio=Math.min(4,Math.max(1,Math.hypot(target[0]-m[4],target[1]-m[5])/Math.max(.001,length))); pose.bones[root].scaleX*=ratio; pose.bones[root].scaleY/=ratio; }
      for(const id of control.bones) {const solved=pose.bones[id];for(const property of ['rotation','scaleX','scaleY'] as const)solved[property]=before[id][property]+(solved[property]-before[id][property])*control.mix;}
    }
    if(control.type==='transform') for(const id of [...control.bones].sort((a,b)=>depth(a)-depth(b))) {
      const world=worldMatrices(c.bones,pose.bones);
      const source=pose.bones[control.targetBoneId!]; let value=source[control.sourceProperty];
      if(control.space==='world') { const m=world[control.targetBoneId!]; if(control.sourceProperty==='x') value=m[4]; if(control.sourceProperty==='y') value=m[5]; if(control.sourceProperty==='rotation') value=degrees(Math.atan2(m[1],m[0])); if(control.sourceProperty==='scaleX')value=Math.hypot(m[0],m[1]);if(control.sourceProperty==='scaleY')value=(m[0]*m[3]-m[1]*m[2])/Math.max(1e-12,Math.hypot(m[0],m[1])); }
      value=value*control.factor+(control.offset?.[control.destinationProperty]??0);
      value=Math.max(control.min??-100000,Math.min(control.max??100000,value));
      if(control.space==='world' && ['x','y'].includes(control.destinationProperty)) {
        const bone=c.bones.find(b=>b.id===id)!, parent=bone.parentId?world[bone.parentId]:identity(), at:Point=[world[id][4],world[id][5]];
        at[control.destinationProperty==='x'?0:1]=value;
        try { const local=point(inverse(parent),at);pose.bones[id].x+=(local[0]-pose.bones[id].x)*control.mix;pose.bones[id].y+=(local[1]-pose.bones[id].y)*control.mix; } catch { continue; }
        continue;
      }
      if(control.space==='world'&&['scaleX','scaleY'].includes(control.destinationProperty)){const bone=c.bones.find(b=>b.id===id)!,m=bone.parentId?world[bone.parentId]:identity(),divisor=control.destinationProperty==='scaleX'?Math.hypot(m[0],m[1]):(m[0]*m[3]-m[1]*m[2])/Math.max(1e-12,Math.hypot(m[0],m[1]));if(Math.abs(divisor)<1e-12)continue;value/=divisor;}
      if(control.space==='world'&&control.destinationProperty==='rotation') turn(id,value);
      else pose.bones[id][control.destinationProperty]+=(value-pose.bones[id][control.destinationProperty])*control.mix;
    }
    if(control.type==='path'&&control.path) control.bones.forEach((id,index)=>{
      const t=Math.min(1,control.position+index*control.spacing), at=bezierPoint(control.path!,t), next=bezierPoint(control.path!,Math.min(1,t+.001));
      const bone=c.bones.find(b=>b.id===id)!;
      try { const local=point(inverse(bone.parentId?worldMatrices(c.bones,pose.bones)[bone.parentId]:identity()),at); pose.bones[id].x+=(local[0]-pose.bones[id].x)*control.mix; pose.bones[id].y+=(local[1]-pose.bones[id].y)*control.mix; } catch { return; }
      if(t<1) turn(id,degrees(Math.atan2(next[1]-at[1],next[0]-at[0])));
    });
  }
  return pose;
}

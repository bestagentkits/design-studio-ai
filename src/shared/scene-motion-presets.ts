import * as T from 'three';
import type { DesignNode } from './schema';
import { boneWorld, solveIK } from './scene-rigging';
export function motionFrames(node:DesignNode,preset:'idle'|'wag'|'walk',start:number,duration:number,strength:number){
  const bones=node.scene!.bones!,rest=boneWorld(bones),feet=bones.map((b,i)=>({name:b.name,index:i,position:new T.Vector3().setFromMatrixPosition(rest[i])})).filter(b=>b.name.endsWith('Foot'));
  const height=node.scene?.mesh?new T.Box3().setFromArray(node.scene.mesh.positions).getSize(new T.Vector3()).y:1;
  return Array.from({length:25},(_,i)=>{
    const phase=i/24,angle=phase*Math.PI*2,values:Record<string,number>={};
    if(preset==='walk'){
      const posed=structuredClone(bones);
      for(const foot of feet){const p=(phase+(/frontLeft|backRight/.test(foot.name)?0:.5))%1,target=foot.position.clone();
        // The stance half moves backward at ground level; the swing half lifts and returns.
        const stride=height*.1*strength,lift=height*.07*strength;
        if(p<.5)target.z+=(.5-p*2)*stride;else {const swing=(p-.5)*2;target.z+=(-.5+swing)*stride;target.y+=Math.sin(swing*Math.PI)*lift;}
        solveIK(posed,foot.name,target.toArray(),2,110);
      }
      posed.forEach((b,j)=>{if(/Upper|Lower/.test(b.name))for(let axis=0;axis<3;axis++)values[`scene.bones.${j}.rotation.${'xyz'[axis]}`]=b.rotation?.[axis]??0;});
    }else bones.forEach((b,j)=>{if(preset==='idle'&&b.name==='head')values[`scene.bones.${j}.rotation.x`]=(b.rotation?.[0]??0)+Math.sin(angle)*5*strength;if(preset==='wag'&&b.name.startsWith('tail'))values[`scene.bones.${j}.rotation.z`]=(b.rotation?.[2]??0)+Math.sin(angle*2-j*.2)*22*strength;});
    if(!Object.keys(values).length)throw new Error(`Rig lacks the named bones required for ${preset}`);
    return {time:start+phase*duration,values};
  });
}

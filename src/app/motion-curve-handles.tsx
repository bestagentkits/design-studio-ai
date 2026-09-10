import type {MotionKey} from '../shared/character-schema';
export function MotionCurveHandles({value,disabled,change}:{value:MotionKey['easing'];disabled?:boolean;change:(value:[number,number,number,number])=>void}){
 const curve=Array.isArray(value)?value:[.25,.1,.25,1];
 return <svg viewBox="-10 -60 120 220" aria-label="Bezier tangent handles" style={{width:'100%',maxHeight:150,touchAction:'none',background:'#f8fafc'}}>
 <path d={`M0 100 C${curve[0]*100} ${100-curve[1]*100},${curve[2]*100} ${100-curve[3]*100},100 0`} fill="none" stroke="#7c3aed"/>
 {[0,1].map(i=><g key={i}><line x1={i*100} y1={100-i*100} x2={curve[i*2]*100} y2={100-curve[i*2+1]*100} stroke="#94a3b8"/><circle aria-label={`Curve handle ${i+1}`} cx={curve[i*2]*100} cy={100-curve[i*2+1]*100} r="5" fill="#2563eb" onPointerDown={e=>{if(!disabled)e.currentTarget.setPointerCapture(e.pointerId);}} onPointerUp={e=>{if(!e.currentTarget.hasPointerCapture(e.pointerId))return;e.currentTarget.releasePointerCapture(e.pointerId);const matrix=e.currentTarget.ownerSVGElement?.getScreenCTM();if(!matrix)return;const p=new DOMPoint(e.clientX,e.clientY).matrixTransform(matrix.inverse()),next=[...curve] as [number,number,number,number];next[i*2]=Math.max(0,Math.min(1,p.x/100));next[i*2+1]=Math.max(-1,Math.min(2,1-p.y/100));change(next);}}/></g>)}
 </svg>;
}

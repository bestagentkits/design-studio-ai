import { useRef, useState } from 'react';
import type { BoardElement } from '../shared/board-schema';
export function DiagramInlineEditor({element,onSave,onCancel}:{element:BoardElement;onSave:(text:string)=>void;onCancel:()=>void}) {
  const [value,setValue]=useState(element.diagram?.label ?? (element.type==='connector'?element.label:''));
  const d=element.diagram,settled=useRef(false);
  const save=()=>{if(settled.current)return;settled.current=true;onSave(value);};
  const cancel=()=>{settled.current=true;onCancel();};
  return <foreignObject x={element.x} y={element.y} width={Math.max(180,element.width)} height={Math.max(96,element.height)} onPointerDown={e=>e.stopPropagation()}>
    <textarea autoFocus aria-label="Edit diagram label" className="diagram-inline-input" style={{fontFamily:d?.fontFamily??(element.type==='connector'?element.labelFontFamily:'Patrick Hand'),fontSize:d?.fontSize??(element.type==='connector'?element.labelFontSize:24),textAlign:d?.align??'center'}} value={value} maxLength={2000} onChange={e=>setValue(e.target.value)} onBlur={save} onKeyDown={e=>{e.stopPropagation();if(e.key==='Escape'){e.preventDefault();cancel();}else if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();save();}}}/>
  </foreignObject>;
}

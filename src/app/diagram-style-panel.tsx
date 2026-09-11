import { useState } from 'react';
import type { Board } from '../shared/board-schema';
import { boardDiagramStyle, cleanDiagramStyle, sketchDiagramStyle, type DiagramStyle } from '../shared/diagram-style';
import type { DiagramOperation } from '../shared/diagram-operations';
export function DiagramStylePanel({board,ids,run}:{board:Board;ids:string[];run:(op:DiagramOperation)=>void}) {
  const [scope,setScope]=useState<'selection'|'board'|'defaults'>('selection'),[name,setName]=useState('My diagram style');
  const node=scope==='defaults'?undefined:board.elements.find(e=>ids.includes(e.id)),defaults=boardDiagramStyle(board);
  const style={...defaults,...(node && 'stroke' in node?node:{}),...node?.diagram,...(node?.type==='connector'?{fontFamily:node.labelFontFamily,fontSize:node.labelFontSize,textColor:node.labelColor??node.stroke}:{})};
  const apply=(changes:Partial<DiagramStyle>,savePreset?:string)=>run({op:'diagram-style',boardId:board.id,style:changes,elementIds:scope==='defaults'?[]:scope==='selection'?ids:undefined,setDefault:scope!=='selection',savePreset});
  return <div className="diagram-style-panel">
    <h4>Appearance</h4><label>Apply to<select aria-label="Diagram style scope" value={scope} onChange={e=>setScope(e.target.value as typeof scope)}><option value="selection">Selected objects</option><option value="board">Entire diagram + defaults</option><option value="defaults">New objects only</option></select></label>
    <div className="diagram-preset-buttons"><button onClick={()=>apply(sketchDiagramStyle)}>Sketch</button><button onClick={()=>apply(cleanDiagramStyle)}>Clean</button></div>
    <label>Font<input aria-label="Diagram font" list="diagram-font-options" value={style.fontFamily} onChange={e=>{if(e.target.value)apply({fontFamily:e.target.value});}}/></label>
    <datalist id="diagram-font-options">{['Patrick Hand','Noto Sans','Lora','Roboto Mono','Arial','Georgia','Courier New'].map(f=><option key={f} value={f}/>)}</datalist>
    <label>Font size<input aria-label="Diagram font size" type="number" min="8" max="128" value={style.fontSize} onChange={e=>{if(+e.target.value>=8)apply({fontSize:+e.target.value});}}/></label>
    <label>Text color<input aria-label="Diagram text color" type="color" value={style.textColor} onChange={e=>apply({textColor:e.target.value})}/></label>
    <label>Alignment<select aria-label="Diagram text alignment" value={style.align} onChange={e=>apply({align:e.target.value as DiagramStyle['align']})}>{['left','center','right'].map(v=><option key={v}>{v}</option>)}</select></label>
    {node?.diagram && <label>Fit node to text<input aria-label="Fit node to text" type="checkbox" checked={node.diagram.autoSize} onChange={e=>run({op:'diagram-update',boardId:board.id,elementId:node.id,changes:{autoSize:e.target.checked}})}/></label>}
    {(['stroke','fill'] as const).map(key=><label key={key}>{key}<input aria-label={`Diagram ${key} color`} type="color" value={style[key].startsWith('#')?style[key]:'#ffffff'} onChange={e=>apply({[key]:e.target.value})}/></label>)}
    <button onClick={()=>apply({fill:'none'})}>Transparent fill</button>
    <label>Line width<input aria-label="Diagram stroke width" type="number" min=".1" max="256" step=".5" value={style.strokeWidth} onChange={e=>{if(+e.target.value>0)apply({strokeWidth:+e.target.value});}}/></label>
    <label>Fill style<select aria-label="Diagram fill style" value={style.fillStyle} onChange={e=>apply({fillStyle:e.target.value as DiagramStyle['fillStyle']})}>{['solid','hachure','cross-hatch'].map(v=><option key={v}>{v}</option>)}</select></label>
    <label>Line style<select aria-label="Diagram line style" value={style.strokeStyle} onChange={e=>apply({strokeStyle:e.target.value as DiagramStyle['strokeStyle']})}>{['solid','dashed','dotted'].map(v=><option key={v}>{v}</option>)}</select></label>
    {([{key:'roughness',title:'Sketch',min:0,max:3,step:.1},{key:'bowing',title:'Bowing',min:0,max:6,step:.1},{key:'fillOpacity',title:'Fill opacity',min:0,max:1,step:.05},{key:'hachureGap',title:'Hatch spacing',min:2,max:40,step:1},{key:'hachureAngle',title:'Hatch angle',min:-180,max:180,step:1}] as const).map(({key,title,min,max,step})=><label key={key}>{title}<input aria-label={`Diagram ${title.toLowerCase()}`} type="range" min={min} max={max} step={step} value={style[key]} onChange={e=>apply({[key]:+e.target.value})}/></label>)}
    <details><summary>Saved styles</summary><label>Style name<input aria-label="Diagram preset name" value={name} maxLength={80} onChange={e=>setName(e.target.value)}/></label><button disabled={!name.trim()} onClick={()=>run({op:'diagram-style',boardId:board.id,style,elementIds:[],setDefault:false,savePreset:name.trim()})}>Save style preset</button>{board.diagramPresets?.map(p=><button key={p.name} onClick={()=>apply(p.style)}>{p.name}</button>)}</details>
  </div>;
}

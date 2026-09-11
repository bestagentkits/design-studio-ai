import { diagramHitTarget, diagramEdgeHitTarget } from '../shared/diagram-hit-testing';
import { diagramNodeSchema } from '../shared/diagram-schema';
import { cleanDiagramStyle, sketchDiagramStyle } from '../shared/diagram-style';
import { DiagramInlineEditor } from './diagram-inline-editor';
import { diagramFontCss } from '../shared/diagram-font-data';
import { fitDiagramBounds } from '../shared/diagram-curve';
import { diagramConnectorPoints } from '../shared/diagram-routing';
import { applyDiagramStyle, boardDiagramStyle } from '../shared/diagram-style';
import { normalizeBoardPath } from '../shared/board-path-normalize';
import { BoardElementView } from './board-element-view';
import { diagramEndpoint, nearestDiagramBinding } from '../shared/diagram-routing';
import { transformedAnchor } from '../shared/board-geometry';
import { boardDraftKey, readBoardDraft, writeBoardDraft, deleteBoardDraft, type BoardDraft } from './board-draft-store';
import { CreativeGifControls } from './creative-elements-gif-controls';
import { captureBoardSelection, duplicateBoardSelectionBundle } from '../shared/board-selection';
import type { Board } from '../shared/board-schema';
import { DiagramPanel } from './diagram-panel';
import { CreativeElementsPanel, recolorBundledSticker } from './creative-elements-panel';
import { CreativeGifElement, useCreativeMotionTime } from './creative-elements-gif';
import { BoardSelectionPanel } from './board-selection-panel';
import { boardDescendants, boardElementLocked, duplicateBoardSelection } from '../shared/board-editing';
import type { DesignOperation } from '../shared/operations';
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { X, MousePointer2, Pencil, Square, Circle, Diamond, Type, ArrowUpRight, Undo2, Redo2, Trash2, Minus, Plus } from 'lucide-react';
import { type DesignDocument, uid } from '../shared/schema';
import { type BoardElement, boardElementSchema } from '../shared/board-schema';
import { boardElementSvg } from '../shared/board-render';
import { InkInput, type InkSample } from '../shared/ink-stroke';
import { mutateDocument } from '../shared/operations';
import './creative-workspace.css';

type Tool = 'select' | 'draw' | 'rectangle' | 'ellipse' | 'diamond' | 'text' | 'connector' | 'pen' | 'erase' | 'hand';
type Gesture = { pointer: number; base: DesignDocument; input: InkInput; points: InkSample[]; element: BoardElement; start: { x: number; y: number }; move: boolean; ids?: string[]; baseCamera?: { x: number; y: number; width: number; height: number }; endpoint?: 'start' | 'end'; segment?: number; handle?: { index: number; x: string; y: string } };
type TextDraft = { id: string; base: DesignDocument; original: string; value: string };
export function CreativeWorkspace({ doc, boardId, projectId, accountId, savedDocument, saveStatus, onSave, onCommit: commit, onClose, onUndo, onRedo }: {
  doc: DesignDocument; boardId: string; projectId?: string; accountId?: string; savedDocument?: DesignDocument; saveStatus?: string; onSave?: () => Promise<void>; onCommit: (base: DesignDocument, next: DesignDocument) => void;
  onClose: () => void; onUndo: () => void; onRedo: () => void;
}) {
  const board = doc.schemaVersion === 2 ? doc.boards.find(b => b.id === boardId) : undefined;
  const [tool, setTool] = useState<Tool>(board?.elements.some(e=>e.diagram)?'select':'draw'), [color, setColor] = useState('#26352d'), [size, setSize] = useState(16);
  const [recovery, setRecovery] = useState<BoardDraft>(), [recoveryError, setRecoveryError] = useState('');
  const draftBase = useRef(savedDocument ?? doc);
  const draftKey = accountId && projectId ? boardDraftKey(accountId, projectId, boardId) : undefined;
  useEffect(() => { let active=true; if(draftKey) void readBoardDraft(draftKey).then(value => { if(!active || !value) return; const existing=doc.schemaVersion===2 ? doc.boards.find(b=>b.id===boardId) : undefined; const pending=value.document.schemaVersion===2 ? value.document.boards.find(b=>b.id===boardId) : undefined; if(JSON.stringify(existing)!==JSON.stringify(pending)) setRecovery(value); }).catch(e=>setRecoveryError(String(e))); return()=>{active=false;}; },[draftKey]);
  useEffect(() => { if(!draftKey || !savedDocument || savedDocument.schemaVersion!==2 || doc.schemaVersion!==2) return; if(JSON.stringify(savedDocument.boards.find(b=>b.id===boardId))===JSON.stringify(doc.boards.find(b=>b.id===boardId))) {
      draftBase.current=savedDocument;
      // A fresh mount also matches the server; only remove a draft that the server actually contains.
      void readBoardDraft(draftKey).then(pending => { if(pending?.document.schemaVersion===2 && JSON.stringify(pending.document.boards.find(b=>b.id===boardId))===JSON.stringify(savedDocument.boards.find(b=>b.id===boardId))) return deleteBoardDraft(draftKey); }).catch(()=>{});
    } },[savedDocument,draftKey]);
  const onCommit = (base: DesignDocument, next: DesignDocument) => { commit(base,next); if(draftKey && accountId && projectId) void writeBoardDraft({ key:draftKey,account:accountId,project:projectId,board:boardId,base:draftBase.current,document:next }).catch(e=>setRecoveryError('Local recovery unavailable: '+String(e))); };
  const [inlineId,setInlineId]=useState<string>();
  const [mode, setMode] = useState<'draw' | 'diagram' | 'elements'>('draw');
  const timeMs = useCreativeMotionTime(!!board?.elements.some(e => e.type === 'gif' && e.playing));
  const [selection, setSelection] = useState<string[]>([]), [snap, setSnap] = useState(true);
  const clipboard = useRef<Board | null>(null);
  const [selected, setSelected] = useState<string>(), [draft, setDraft] = useState<BoardElement>(), [error, setError] = useState('');
  const [textDraft, setTextDraft] = useState<TextDraft | null>(null);
  const [camera, setCamera] = useState({ x: 0, y: 0, width: 960, height: 640 });
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ distance: number; center: { x: number; y: number }; camera: typeof camera } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const lastTap=useRef<{id:string;time:number}|undefined>(undefined);
  useEffect(() => { const opener = document.activeElement as HTMLElement | null; dialog.current?.showModal(); return () => opener?.focus(); }, []);
  const svg = useRef<SVGSVGElement>(null), gesture = useRef<Gesture | null>(null), frame = useRef(0);
  const cancel = () => { gesture.current = null; cancelAnimationFrame(frame.current); frame.current = 0; setDraft(undefined); };
  useEffect(() => { const blur = () => { touches.current.clear(); pinch.current = null; cancel(); }; window.addEventListener('blur', blur); return () => { window.removeEventListener('blur', blur); cancelAnimationFrame(frame.current); }; }, []);
  const ids = selection.length ? selection : selected ? [selected] : [];
  const active = board?.elements.find(e => e.id === selected);
  const activeText = active?.type === 'text' ? active.text : undefined;
  useEffect(() => {
    if (active?.type !== 'text') { setTextDraft(null); return; }
    setTextDraft(current => current?.id === active.id ? current : { id: active.id, base: structuredClone(doc), original: active.text, value: active.text });
  }, [active?.id, activeText, active?.type]);
  if (!board) return <div role="alert">Board unavailable. <button onClick={onClose}>Return to editor</button></div>;
  const apply = (actions: DesignOperation[]) => { try { cancel(); onCommit(doc, mutateDocument(doc, actions)); setError(''); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } };
  const copy = () => { clipboard.current = captureBoardSelection(board, ids); };
  const paste = () => { if (!clipboard.current) return; const bundle = duplicateBoardSelectionBundle(clipboard.current, clipboard.current.elements.map(e => e.id)); if (bundle.elements.length) { apply([{ op: 'paste-board-elements', boardId, ...bundle }]); setSelection(bundle.elements.map(e => e.id)); setSelected(bundle.elements[0].id); } };
  const commitTextDraft = (entry = textDraft) => {
    if (!entry) return true;
    if (entry.value === entry.original) { setTextDraft(null); return true; }
    try {
      const sourceBoard = entry.base.schemaVersion === 2 ? entry.base.boards.find(b => b.id === boardId) : undefined;
      const source = sourceBoard?.elements.find(e => e.id === entry.id);
      if (source?.type !== 'text') throw new Error('Text element changed. Select it again before editing.');
      onCommit(entry.base, mutateDocument(entry.base, [{ op: 'upsert-board-elements', boardId, elements: [{ ...source, text: entry.value }] }]));
      setTextDraft(null); return true;
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); return false; }
  };
  const point = (event: { clientX: number; clientY: number }) => {
    const matrix = svg.current?.getScreenCTM(); if (!matrix) throw new Error('Canvas is not ready');
    const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse()); return { x: p.x, y: p.y };
  };
  const refresh = () => { if (!frame.current) frame.current = requestAnimationFrame(() => { frame.current = 0; if (gesture.current) setDraft(structuredClone(gesture.current.element)); }); };
  const inlineElement=board.elements.find(e=>e.id===inlineId);
  const finishInline=(value:string)=>{if(!inlineElement)return;apply(inlineElement.diagram?[{op:'diagram-update',boardId,elementId:inlineElement.id,changes:{label:value}}]:inlineElement.type==='connector'?[{op:'diagram-edge',boardId,edgeId:inlineElement.id,label:value}]:[]);setInlineId(undefined);};
  const down = (event: PointerEvent<SVGSVGElement>) => {
    if (event.pointerType === 'touch') { touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY }); if (touches.current.size === 2) { cancel(); const [a,b] = [...touches.current.values()]; pinch.current = { distance: Math.max(1, Math.hypot(a.x-b.x,a.y-b.y)), center: { x: (a.x+b.x)/2,y:(a.y+b.y)/2 }, camera }; event.currentTarget.setPointerCapture(event.pointerId); return; } }
    if (event.button !== 0 || gesture.current || pinch.current) return;
    event.preventDefault(); setError('');
    try {
      const start = point(event), hit = (event.target as Element).closest('[data-board-element]')?.getAttribute('data-board-element');
      const isHandle=(event.target as Element).closest('[data-connector-end],[data-edge-segment],[data-diagram-port],[data-path-handle]');
      let target = board.elements.find(e => e.id === hit) ?? (isHandle ? undefined : diagramEdgeHitTarget(board,start,6/(svg.current?.getScreenCTM()?.a||1)) ?? diagramHitTarget(board,start));
      if(!isHandle && tool==='select' && target && (target.diagram||target.type==='connector') && !boardElementLocked(board,target)){if(lastTap.current?.id===target.id && event.timeStamp-lastTap.current.time<400){lastTap.current=undefined;cancel();setInlineId(target.id);return;}lastTap.current={id:target.id,time:event.timeStamp};}
      if (target?.parentId && !event.altKey && tool === 'select') { while (target?.parentId) target = board.elements.find(e => e.id === target!.parentId); }
      const segment=(event.target as Element).getAttribute('data-edge-segment');
      if(segment!==null && active?.type==='connector' && !boardElementLocked(board,active)){const element=structuredClone(active);const points=diagramConnectorPoints(board,element);element.bends=points.slice(1,-1);gesture.current={pointer:event.pointerId,base:doc,input:new InkInput(false),points:[],element,start,move:false,segment:+segment};event.currentTarget.setPointerCapture(event.pointerId);return;}
      const port=(event.target as Element).getAttribute('data-diagram-port');
      const endpoint = (event.target as Element).getAttribute('data-connector-end') as 'start' | 'end' | null;
      if (endpoint && active?.type === 'connector' && !boardElementLocked(board, active)) { gesture.current = { pointer:event.pointerId,base:doc,input:new InkInput(false),points:[],element:structuredClone(active),start,move:false,endpoint }; event.currentTarget.setPointerCapture(event.pointerId); return; }
      const handle = (event.target as Element).getAttribute('data-path-handle');
      if (handle && active?.type === 'path' && !boardElementLocked(board, active)) { const [index, x, y] = handle.split(':'); gesture.current = { pointer: event.pointerId, base: doc, input: new InkInput(false), points: [], element: structuredClone(active), start, move: false, handle: { index: +index, x, y } }; event.currentTarget.setPointerCapture(event.pointerId); return; }
      if (tool === 'erase') { if (target) apply([{ op: 'remove-board-elements', boardId, elementIds: [target.id] }]); return; }
      if (port && active?.diagram) { const p=active.diagram.ports.find(p=>p.id===port)!; const element=applyDiagramStyle(boardElementSchema.parse({...boardDiagramStyle(board),id:uid(),name:'Connection',type:'connector',x:0,y:0,width:1,height:1,start:{point:start,binding:{elementId:active.id,anchor:{x:p.x,y:p.y},port:p.id}},end:{point:start},routing:active.diagram.family==='mind-map'?'curve':'elbow',bends:[],startArrow:'none',endArrow:active.diagram.family==='mind-map'?'none':'arrow'}),boardDiagramStyle(board));gesture.current={pointer:event.pointerId,base:doc,input:new InkInput(false),points:[],element,start,move:false};event.currentTarget.setPointerCapture(event.pointerId);return;}
      if (tool === 'select' && target && event.shiftKey) { setSelection(current => { const old = current.length ? current : selected ? [selected] : []; return old.includes(target!.id) ? old.filter(id => id !== target!.id) : [...old, target!.id]; }); setSelected(target.id); return; }
      if (tool === 'select' && !target) { setSelected(undefined); setSelection([]); return; }
      if (tool === 'select' && target && boardElementLocked(board, target)) { setError('Unlock this element before moving it.'); return; }
      const input = new InkInput(event.pointerType === 'pen');
      const sample = input.sample(start.x, start.y, event.timeStamp, event.pointerType === 'pen' ? event.pressure : .5);
      const base = { id: uid(), name: tool === 'draw' ? 'Ink stroke' : tool, x: start.x, y: start.y, width: 1, height: 1, stroke: color, fill: 'none', strokeWidth: tool === 'draw' ? size : 2 };
      let element: BoardElement;
      if (tool === 'hand') element = boardElementSchema.parse({ ...base, type: 'group' });
      else if (tool === 'pen' && active?.type === 'path') { element = structuredClone(active); const angle=-element.rotation*Math.PI/180,dx=start.x-element.x-element.width/2,dy=start.y-element.y-element.height/2; element.commands.push({ op:'L',x:(dx*Math.cos(angle)-dy*Math.sin(angle))*(element.flipX?-1:1)+element.width/2,y:(dx*Math.sin(angle)+dy*Math.cos(angle))*(element.flipY?-1:1)+element.height/2 }); }
      else if (tool === 'pen') element = boardElementSchema.parse({ ...base, type: 'path', commands: [{ op: 'M', x: 0, y: 0 }] });
      else if (tool === 'select' && target) element = structuredClone(target);
      else if (tool === 'draw') element = boardElementSchema.parse({ ...base, type: 'stroke', algorithm: 'perfect-freehand-1.2.3', points: [{ ...sample, x: 0, y: 0 }] });
      else if (tool === 'connector') element = boardElementSchema.parse({ ...base, x: 0, y: 0, type: 'connector', start: { point: start, ...(target && !['connector', 'group'].includes(target.type) ? { binding: nearestDiagramBinding(target, start) } : {}) }, end: { point: start }, routing: 'elbow', bends: [], startArrow: 'none', endArrow: 'arrow' });
      else if (tool === 'text') element = boardElementSchema.parse({ ...base, type: 'text', text: 'Text', width: 240, height: 48, fontFamily: 'Arial', fontSize: 28 });
      else element = boardElementSchema.parse({ ...base, type: 'shape', shape: tool, fill: '#eef3ed' });
      if(mode==='diagram' && element.type==='shape' && tool!=='select') element.diagram=diagramNodeSchema.parse({family:'flowchart',role:element.shape==='diamond'?'decision':element.shape==='ellipse'?'start':'process',label:'New step',fontFamily:'Patrick Hand',fontSize:24,autoSize:false,ports:[{id:'top',x:.5,y:0},{id:'right',x:1,y:.5},{id:'bottom',x:.5,y:1},{id:'left',x:0,y:.5}]});
      if(mode==='diagram' && tool!=='select') element=applyDiagramStyle(element,boardDiagramStyle(board));
      gesture.current = { pointer: event.pointerId, base: doc, input, points: [sample], element, start, move: tool === 'select', ids: target && ids.includes(target.id) ? ids : [element.id], baseCamera: tool === 'hand' ? camera : undefined };
      if (tool !== 'hand') { setSelected(element.id); if (!target || !ids.includes(target.id)) setSelection([element.id]); } setDraft(element); event.currentTarget.setPointerCapture(event.pointerId);
    } catch (e) { cancel(); setError(String(e)); }
  };
  const move = (event: PointerEvent<SVGSVGElement>) => {
    if (event.pointerType === 'touch' && touches.current.has(event.pointerId)) touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinch.current && touches.current.size >= 2) { const [a,b] = [...touches.current.values()], initial = pinch.current, factor = initial.distance / Math.max(1, Math.hypot(a.x-b.x,a.y-b.y)), rect = svg.current!.getBoundingClientRect(); const width = Math.min(20000, Math.max(96, initial.camera.width * factor)), height = width * initial.camera.height / initial.camera.width; setCamera({ width, height, x: initial.camera.x + (initial.center.x-rect.left) / rect.width * initial.camera.width - ((a.x+b.x)/2-rect.left) / rect.width * width, y: initial.camera.y + (initial.center.y-rect.top) / rect.height * initial.camera.height - ((a.y+b.y)/2-rect.top) / rect.height * height }); return; }
    const g = gesture.current; if (!g || g.pointer !== event.pointerId) return;
    try {
      const events = event.nativeEvent.getCoalescedEvents?.() ?? []; const samples = events.length ? events : [event.nativeEvent];
      for (const e of samples) {
        const p = point(e), last = g.points.at(-1)!;
        if(g.move && Math.hypot(p.x-g.start.x,p.y-g.start.y)>3)lastTap.current=undefined;
        if(g.segment!==undefined && g.element.type==='connector'){if(g.element.routing==='curve'){g.element.bends=[p];refresh();return;}const original=g.base.schemaVersion===2?g.base.boards.find(b=>b.id===boardId)!.elements.find(e=>e.id===g.element.id):undefined;if(original?.type==='connector'){const route=diagramConnectorPoints(board,original),i=g.segment,a=route[i],b=route[i+1];if(a&&b){const horizontal=Math.abs(b.x-a.x)>=Math.abs(b.y-a.y);const q=horizontal?{x:a.x,y:p.y}:{x:p.x,y:a.y},r=horizontal?{x:b.x,y:p.y}:{x:p.x,y:b.y};g.element.bends=[...route.slice(1,i),q,r,...route.slice(i+2,-1)];}}refresh();return;}
        if (g.endpoint && g.element.type === 'connector') { g.element[g.endpoint] = { point:p }; refresh(); return; }
        if (g.baseCamera) { const rect = svg.current!.getBoundingClientRect(); setCamera({ ...g.baseCamera, x: g.baseCamera.x - event.movementX * g.baseCamera.width / rect.width, y: g.baseCamera.y - event.movementY * g.baseCamera.height / rect.height }); g.baseCamera = { ...g.baseCamera, x: g.baseCamera.x - event.movementX * g.baseCamera.width / rect.width, y: g.baseCamera.y - event.movementY * g.baseCamera.height / rect.height }; return; }
        if (g.handle && g.element.type === 'path') { const c = g.element.commands[g.handle.index] as unknown as Record<string, number>; const angle = -g.element.rotation * Math.PI / 180, dx = p.x - g.element.x - g.element.width / 2, dy = p.y - g.element.y - g.element.height / 2; c[g.handle.x] = (dx * Math.cos(angle) - dy * Math.sin(angle)) * (g.element.flipX ? -1 : 1) + g.element.width / 2; c[g.handle.y] = (dx * Math.sin(angle) + dy * Math.cos(angle)) * (g.element.flipY ? -1 : 1) + g.element.height / 2; }
        else if (g.move) {
          const original = g.base.schemaVersion === 2 ? g.base.boards.find(b => b.id === boardId)!.elements.find(el => el.id === g.element.id)! : g.element;
          if (g.element.type === 'connector' && (g.element.start.binding || g.element.end.binding)) { setError('Drag an endpoint handle to reconnect this edge.'); continue; }
          g.element.x = original.x + p.x - g.start.x; g.element.y = original.y + p.y - g.start.y; if (snap && !event.altKey) { g.element.x = Math.round(g.element.x / 8) * 8; g.element.y = Math.round(g.element.y / 8) * 8; }
        } else if (g.element.type === 'stroke') {
          if (g.points.length >= 4096) throw new Error('Stroke is too long. Draw the next part as a new stroke.');
          const sample = g.input.sample(p.x, p.y, Math.max(e.timeStamp, last.time), e.pointerType === 'pen' ? (e.pressure || last.pressure) : .5);
          g.points.push(sample); g.element.points.push({ x: sample.x - g.start.x, y: sample.y - g.start.y, pressure: sample.pressure });
          g.element.width = Math.max(1, ...g.points.map(s => Math.abs(s.x - g.start.x))); g.element.height = Math.max(1, ...g.points.map(s => Math.abs(s.y - g.start.y)));
        } else if (g.element.type === 'connector') g.element.end = { point: p };
        else if (g.element.type === 'shape') { g.element.x = Math.min(p.x, g.start.x); g.element.y = Math.min(p.y, g.start.y); g.element.width = Math.max(1, Math.abs(p.x - g.start.x)); g.element.height = Math.max(1, Math.abs(p.y - g.start.y)); }
      }
      refresh();
    } catch (e) { cancel(); setError(e instanceof Error ? e.message : String(e)); }
  };
  const up = (event: PointerEvent<SVGSVGElement>) => {
    touches.current.delete(event.pointerId); if (pinch.current) { if (!touches.current.size) pinch.current = null; return; }
    if (gesture.current?.pointer !== event.pointerId) return;
    const pending=gesture.current,endPoint=point(event);
    if(pending.move && Math.hypot(endPoint.x-pending.start.x,endPoint.y-pending.start.y)<3){cancel();return;}
    move(event); const g = gesture.current; if (!g) return;
    try {
      if (g.element.type === 'connector' && g.segment===undefined) {
        // Endpoint handles sit above nodes; look through overlays when rebinding.
        const hits = document.elementsFromPoint(event.clientX, event.clientY).map(e => e.closest('[data-board-element]')?.getAttribute('data-board-element'));
        const target = diagramHitTarget(board,point(event)) ?? hits.map(id => board.elements.find(e => e.id === id && !['connector', 'group'].includes(e.type))).find(Boolean);
        if (target) g.element[g.endpoint ?? 'end'].binding = nearestDiagramBinding(target, point(event), diagramEndpoint(board,g.element[g.endpoint==='start'?'end':'start']));
      }
      if (g.baseCamera) return;
      if (!g.move && g.element.type === 'stroke') { const minX = Math.min(...g.element.points.map(p => p.x)), minY = Math.min(...g.element.points.map(p => p.y)), maxX = Math.max(...g.element.points.map(p => p.x)), maxY = Math.max(...g.element.points.map(p => p.y)); g.element.x += minX; g.element.y += minY; g.element.width = Math.max(1, maxX-minX); g.element.height = Math.max(1,maxY-minY); g.element.points = g.element.points.map(p => ({ ...p, x:p.x-minX, y:p.y-minY })); }
      if (!g.move && g.element.type === 'path') normalizeBoardPath(g.element);
      const original = g.base.schemaVersion === 2 ? g.base.boards.find(b => b.id === boardId)?.elements.find(e => e.id === g.element.id) : undefined;
      const actions: DesignOperation[] = g.move && original ? [{ op: 'transform-board-elements', boardId, elementIds: g.ids!, dx: g.element.x - original.x, dy: g.element.y - original.y, scaleX: 1, scaleY: 1, rotation: 0, flipX: false, flipY: false }] : [{ op: 'upsert-board-elements', boardId, elements: [g.element] }];
      const next = mutateDocument(g.base, actions);
      onCommit(g.base, next);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { cancel(); }
  };
  const remove = () => { if (selected) { try { setTextDraft(null); onCommit(doc, mutateDocument(doc, [{ op: 'remove-board-elements', boardId, elementIds: ids }])); setSelected(undefined); setSelection([]); } catch (e) { setError(String(e)); } } };
  const tools = [['select', MousePointer2, 'Select'], ['draw', Pencil, 'Draw'], ['rectangle', Square, 'Rectangle'], ['ellipse', Circle, 'Ellipse'], ['diamond', Diamond, 'Decision'], ['text', Type, 'Text'], ['connector', ArrowUpRight, 'Connect'], ['pen', Pencil, 'Pen'], ['erase', Trash2, 'Eraser'], ['hand', MousePointer2, 'Hand']] as const;
  const textPreview = active?.type === 'text' && textDraft?.id === active.id ? { ...active, text: textDraft.value } : undefined;
  const previewGesture = gesture.current;
  let movePreview: Board | undefined;
  if (draft && previewGesture?.move) { try { const original = previewGesture.base.schemaVersion === 2 ? previewGesture.base.boards.find(b => b.id === boardId)?.elements.find(e => e.id === draft.id) : undefined; if (original) { const previewDoc = mutateDocument(previewGesture.base, [{ op:'transform-board-elements',boardId,elementIds:previewGesture.ids!,dx:draft.x-original.x,dy:draft.y-original.y,scaleX:1,scaleY:1,rotation:0,flipX:false,flipY:false }]); if(previewDoc.schemaVersion===2) movePreview = previewDoc.boards.find(b=>b.id===boardId); } } catch {} }
  const displayBoard = movePreview ?? (textPreview ? { ...board, elements: board.elements.map(e => e.id === textPreview.id ? textPreview : e) } : board);
  const renderElements = displayBoard.elements.filter(e => { if (e.type === 'connector' || e.type === 'group') return true; const r = Math.hypot(e.width,e.height)/2 + ('strokeWidth' in e ? e.strokeWidth : 0), cx=e.x+e.width/2,cy=e.y+e.height/2; return cx+r>=camera.x && cy+r>=camera.y && cx-r<=camera.x+camera.width && cy-r<=camera.y+camera.height; });
  return <dialog ref={dialog} className="creative-workspace" aria-label="Creative board" onCancel={e => { e.preventDefault(); if (gesture.current) cancel(); else onClose(); }} onKeyDown={e => {
    e.stopPropagation(); if ((e.target as HTMLElement).matches('input,textarea,select')) return;
    if (e.key === 'Escape') { if (gesture.current) cancel(); else onClose(); }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); cancel(); setTextDraft(null); e.shiftKey ? onRedo() : onUndo(); }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); setSelection(board.elements.map(el => el.id)); setSelected(board.elements[0]?.id); }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c') { e.preventDefault(); copy(); }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'v') { e.preventDefault(); paste(); }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); copy(); paste(); }
    if(active?.diagram?.family==='mind-map' && e.altKey && (e.key==='Enter'||e.key==='ArrowRight')){e.preventDefault();apply([{op:'mind-map-insert',boardId,relativeId:active.id,relation:e.key==='Enter'?'sibling':'child',id:uid(),label:'New idea'}]);return;}
    if(e.key==='Enter' && active && (active.diagram||active.type==='connector')&&!boardElementLocked(board,active)){e.preventDefault();setInlineId(active.id);return;}
    if(!e.metaKey&&!e.ctrlKey&&!e.altKey){const shortcuts:Record<string,Tool>={v:'select',p:'draw',a:'connector',t:'text',h:'hand'};if(shortcuts[e.key.toLowerCase()])setTool(shortcuts[e.key.toLowerCase()]);}
    if (ids.length && ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)) { e.preventDefault(); const d = e.shiftKey ? 10 : 1; apply([{ op: 'transform-board-elements', boardId, elementIds: ids, dx: e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0, dy: e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0, scaleX: 1, scaleY: 1, rotation: 0, flipX: false, flipY: false }]); }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove(); }
  }}>
    <header><div><span className="creative-eyebrow">DESIGN STUDIO / BOARD</span><h2>{board.name}</h2></div><span className="creative-save-note">{saveStatus || 'Edits join your project · Save in Studio'}</span>{onSave && <button disabled={saveStatus === 'Saving'} onClick={() => { if (!gesture.current && commitTextDraft()) void onSave(); }}>Save Board</button>}<button aria-label="Close creative board" onClick={onClose}><X size={20}/></button></header>
    {recovery && <div role="alert">A local Board draft is available. <button onClick={() => { try { commit(recovery.base,recovery.document); draftBase.current=recovery.base; setRecovery(undefined); } catch(e) { setRecoveryError(String(e)); } }}>Restore draft</button><button onClick={() => { if(draftKey) void deleteBoardDraft(draftKey); setRecovery(undefined); }}>Discard draft</button></div>}{recoveryError && <p role="alert">{recoveryError}</p>}<div className="creative-main"><aside><nav aria-label="Creative modes">{(['draw', 'diagram', 'elements'] as const).map(m => <button key={m} aria-label={m === 'draw' ? 'Sketch workspace' : `${m} mode`} aria-pressed={mode === m} onClick={() => {setMode(m);if(m==='diagram'){setTool('select');setCamera(fitDiagramBounds(board.elements));}}}>{m}</button>)}</nav>{mode === 'diagram' && <DiagramPanel doc={doc} boardId={boardId} selectedIds={ids} onCommit={onCommit}/>}{mode === 'elements' && <CreativeElementsPanel selectedElement={active} doc={doc} boardId={boardId} projectId={projectId} onCommit={onCommit} onInserted={id => { setSelected(id); setSelection([id]); setTool('select'); }}/>}<label>Ink color<input aria-label="Ink color" type="color" value={color} onChange={e => setColor(e.target.value)}/></label><label>Stroke size <b>{size}px</b><input aria-label="Stroke size" type="range" min="2" max="64" value={size} onChange={e => setSize(+e.target.value)}/></label><p>Move slowly for a fuller line. Move quickly for a fine, tapered stroke.</p>
      {active?.type === 'text' && textDraft && <label>Text<textarea aria-label="Board text" value={textDraft.value} onChange={e => setTextDraft({ ...textDraft, value: e.target.value })} onBlur={e => commitTextDraft({ ...textDraft, value: e.currentTarget.value })}/></label>}
      <label>Snap to grid<input aria-label="Snap to grid" type="checkbox" checked={snap} onChange={e => setSnap(e.target.checked)}/></label><button disabled={!ids.length} onClick={copy}>Copy</button><button onClick={paste}>Paste</button><>{active?.type === 'gif' && <CreativeGifControls doc={doc} boardId={boardId} projectId={projectId} onCommit={onCommit} element={active} timeMs={timeMs}/>}</><BoardSelectionPanel board={board} ids={ids} apply={apply}/>
      <button disabled={!selected} onClick={remove}><Trash2 size={16}/> Delete selection</button>
    </aside><section className="creative-paper"><nav aria-label="Board tools">{tools.map(([key, Icon, label]) => <button key={key} aria-label={label} aria-pressed={tool === key} onClick={() => { cancel(); setTool(key); }}><Icon size={20}/><span>{label}</span></button>)}<i/><button aria-label="Undo board edit" onClick={() => { cancel(); setTextDraft(null); onUndo(); }}><Undo2 size={19}/></button><button aria-label="Redo board edit" onClick={() => { cancel(); setTextDraft(null); onRedo(); }}><Redo2 size={19}/></button></nav>
      {mode==='diagram' && active && (active.diagram || active.type==='connector') && <div role="toolbar" aria-label="Selected diagram tools" className="diagram-context-tools"><button disabled={boardElementLocked(board,active)} onClick={()=>setInlineId(active.id)}>Edit label</button><button onClick={()=>apply([{op:'diagram-style',boardId,elementIds:ids,style:sketchDiagramStyle,setDefault:false}])}>Sketch style</button><button onClick={()=>apply([{op:'diagram-style',boardId,elementIds:ids,style:cleanDiagramStyle,setDefault:false}])}>Clean style</button>{active.diagram?.family==='mind-map' && <button onClick={()=>apply([{op:'mind-map-insert',boardId,relativeId:active.id,relation:'child',id:uid(),label:'New idea'}])}>Add branch</button>}</div>}
      <svg ref={svg} tabIndex={0} aria-label="Drawing canvas" viewBox={`${camera.x} ${camera.y} ${camera.width} ${camera.height}`} preserveAspectRatio="xMidYMid meet" onDoubleClick={e=>{const id=(e.target as Element).closest('[data-board-element]')?.getAttribute('data-board-element') ?? selected;const n=board.elements.find(n=>n.id===id);if(n&&(n.diagram||n.type==='connector')&&!boardElementLocked(board,n)){cancel();setInlineId(n.id);}}} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={e => { touches.current.delete(e.pointerId); pinch.current = null; cancel(); }} onLostPointerCapture={() => { if (!pinch.current) cancel(); }} onWheel={e => { if (gesture.current) return; if (e.ctrlKey || e.metaKey) { const factor = e.deltaY > 0 ? 1.1 : .9; setCamera(c => ({ ...c, width: Math.min(20000, Math.max(96, c.width * factor)), height: Math.min(14000, Math.max(64, c.height * factor)) })); } else setCamera(c => ({ ...c, x: c.x + e.deltaX, y: c.y + e.deltaY })); }}>
        <style>{diagramFontCss}</style>
        <rect x={camera.x} y={camera.y} width={camera.width} height={camera.height} fill={board.background}/>
        {renderElements.filter(e => movePreview || e.id !== draft?.id).map(e => e.type === 'gif' ? <CreativeGifElement key={e.id} element={e} board={displayBoard} doc={doc} timeMs={timeMs}/> : <BoardElementView key={e.id} board={displayBoard} element={e} doc={doc}/>) }
        {draft && !movePreview && <g pointerEvents="none" dangerouslySetInnerHTML={{ __html: boardElementSvg({ ...displayBoard, elements: [...displayBoard.elements.filter(e => e.id !== draft.id), draft] }, draft, doc) }}/>}
        {active?.type === 'connector' && tool === 'select' && <g>{(['start','end'] as const).map(end => { const p = diagramEndpoint(displayBoard, (draft?.type === 'connector' ? draft : active)[end]); return <circle key={end} data-connector-end={end} cx={p.x} cy={p.y} r={7} fill="white" stroke="#326550"/>; })}</g>}
        {active?.type==='connector' && tool==='select' && <g>{(()=>{try{return diagramConnectorPoints(displayBoard,active).slice(1).map((p,i,rest)=>{if(active.routing==='curve' && i!==Math.floor(rest.length/2))return null;const a=i?rest[i-1]:diagramEndpoint(displayBoard,active.start);return <circle key={i} data-edge-segment={i} cx={(a.x+p.x)/2} cy={(a.y+p.y)/2} r={7} fill="#e6eddf" stroke="#326550"/>;});}catch{return null;}})()}</g>}
        {active?.diagram && tool==='select' && !boardElementLocked(board,active) && <g>{active.diagram.ports.map(p=>{const pos=transformedAnchor(active,p);return <circle key={p.id} data-diagram-port={p.id} cx={pos.x} cy={pos.y} r={8} fill="white" stroke="#326550"><title>Drag to connect</title></circle>;})}</g>}
        {inlineElement && <DiagramInlineEditor key={inlineElement.id} element={inlineElement.type==='connector'?{...inlineElement,x:diagramEndpoint(board,inlineElement.start).x,y:diagramEndpoint(board,inlineElement.start).y,width:240,height:96}:inlineElement} onSave={finishInline} onCancel={()=>setInlineId(undefined)}/>}
        {active?.type === 'path' && (tool === 'select' || tool === 'pen') && <g transform={`translate(${active.x} ${active.y}) rotate(${active.rotation} ${active.width / 2} ${active.height / 2}) translate(${active.flipX ? active.width : 0} ${active.flipY ? active.height : 0}) scale(${active.flipX ? -1 : 1} ${active.flipY ? -1 : 1})`}>{(draft?.type === 'path' ? draft.commands : active.commands).flatMap((c, i) => (['x','x1','x2'] as const).flatMap(x => { const y = x.replace('x','y'); const values = c as unknown as Record<string, number>; return typeof values[x] === 'number' ? [<circle key={`${i}:${x}`} data-path-handle={`${i}:${x}:${y}`} cx={values[x]} cy={values[y]} r={5} fill={x === 'x' ? '#fff' : '#b8d9cd'} stroke="#326550"/>] : []; }))}</g>}
        {active && tool === 'select' && active.type !== 'connector' && <rect pointerEvents="none" x={draft?.x ?? active.x} y={draft?.y ?? active.y} width={active.width} height={active.height} fill="none" stroke="#2b6955" strokeWidth="1.5" strokeDasharray="5 4"/>}
      </svg><footer><span>{error || `${board.elements.length} elements · ${tool === 'draw' ? 'Pressure-sensitive ink' : 'One gesture, one undo'}`}</span><div><button aria-label="Zoom out" onClick={() => setCamera(c => ({ ...c, width: Math.min(20000, c.width * 1.2), height: Math.min(14000, c.height * 1.2) }))}><Minus size={16}/></button><button onClick={() => setCamera({ x: 0, y: 0, width: 960, height: 640 })}>Reset view</button><button onClick={()=>setCamera(fitDiagramBounds(board.elements))}>Fit diagram</button><button aria-label="Zoom in" onClick={() => setCamera(c => ({ ...c, width: Math.max(96, c.width / 1.2), height: Math.max(64, c.height / 1.2) }))}><Plus size={16}/></button></div></footer>
    </section></div>
  </dialog>;
}

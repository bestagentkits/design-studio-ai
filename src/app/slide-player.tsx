import { screenParam, useScreenState, writeScreen } from './screen-state';
import { ArrowLeft, ArrowRight, X, Maximize, Monitor, Play, Pause, EyeOff, Eye } from 'lucide-react';
import { presentationStyles } from './presentation-styles';
import { useEffect, useRef, useState } from 'react';
import type { DesignDocument } from '../shared/schema';
import { renderSvg } from '../shared/render';
import { DocumentView, usesDom } from './document-view';

function Slide({ doc, index, navigate, time=0, playback=false }: {time?:number;playback?:boolean; doc: DesignDocument; index: number; navigate: (id: string) => void }) {
  const ref = useRef<HTMLDivElement>(null), [width, setWidth] = useState(doc.pages[index].width);
  const page = doc.pages[index];
  useEffect(() => { const host = ref.current; if (!host) return; const observer = new ResizeObserver(() => setWidth(host.clientWidth)); observer.observe(host); return () => observer.disconnect(); }, []);
  return <div ref={ref} style={{ width: '100%', aspectRatio: `${page.width}/${page.height}`, overflow: 'hidden' }}><div style={{ width: page.width, height: page.height, transform: `scale(${width / page.width})`, transformOrigin: 'top left' }}>{usesDom(page) ? <DocumentView doc={doc} pageIndex={index} navigate={navigate} time={time} playback={playback}/> : <div dangerouslySetInnerHTML={{ __html: renderSvg(doc, index) }}/>}</div></div>;
}

export function SlidePlayer({ doc, close, notes = false }: { doc: DesignDocument; close?: () => void; notes?: boolean }) {
  const [index, setIndexState] = useState(() => Math.max(0, Math.min(doc.pages.length - 1, Math.trunc(Number(screenParam('slide', '1'))) - 1 || 0))), [mode, setMode] = useScreenState('view', 'present', ['present', 'overview', 'read']), [playing, play] = useState(false), [seconds, setSeconds] = useState(0), [blank, setBlank] = useState(false);
  const [interval, setIntervalSeconds] = useState(doc.presentation?.interval ?? 5), [loop, setLoop] = useState(doc.presentation?.loop ?? false);
  const host = useRef<HTMLDivElement>(null), touch = useRef(0), presenter = useRef<Window | null>(null);
  const [motionTime,setMotionTime]=useState(0),[motionPlaying,setMotionPlaying]=useState(false);
  useEffect(()=>{setMotionTime(0);setMotionPlaying(false);},[index]);
  useEffect(()=>{if(!motionPlaying||blank)return;let frame=0,previous=performance.now();const tick=(now:number)=>{setMotionTime(t=>(t+(now-previous)/1000)%(doc.timeline?.duration??10));previous=now;frame=requestAnimationFrame(tick);};frame=requestAnimationFrame(tick);return()=>cancelAnimationFrame(frame);},[motionPlaying,blank,doc.timeline?.duration]);
  const current = doc.pages[index];
  const setIndex = (next: number | ((value: number) => number)) => setIndexState(previous => typeof next === 'function' ? next(previous) : next);
  useEffect(() => { writeScreen({ slide: String(index + 1) }, true); }, [index]);
  useEffect(() => { const restore = () => setIndexState(Math.max(0, Math.min(doc.pages.length - 1, Math.trunc(Number(screenParam('slide', '1'))) - 1 || 0))); window.addEventListener('popstate', restore); return () => window.removeEventListener('popstate', restore); }, [doc.pages.length]);
  const go = (next: number) => setIndex(loop ? (next + doc.pages.length) % doc.pages.length : Math.max(0, Math.min(doc.pages.length - 1, next)));
  useEffect(() => { const timer = window.setInterval(() => setSeconds(s => s + 1), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => { if (!playing) return; const timer = window.setInterval(() => setIndex(i => { if (i === doc.pages.length - 1) { if (loop) return 0; play(false); return i; } return i + 1; }), interval * 1000); return () => clearInterval(timer); }, [playing, interval, loop, doc.pages.length]);
  useEffect(() => { const key = (e: KeyboardEvent) => { if ((e.target as HTMLElement).closest('input,select,textarea,button,a,[contenteditable]')) return; if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); go(index + 1); } if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) { e.preventDefault(); go(index - 1); } if (e.key === 'Home') go(0); if (e.key === 'End') go(doc.pages.length - 1); if (e.key.toLowerCase() === 'b') setBlank(v => !v); if (e.key === 'Escape') close?.(); }; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key); }, [index, loop, close]);
  useEffect(() => { if (!presenter.current || presenter.current.closed) return; const document = presenter.current.document; const content = document.getElementById('notes'); if (content) content.textContent = `Slide ${index + 1} / ${doc.pages.length}\n${current.name}\n\n${current.notes ?? 'No speaker notes.'}\n\nElapsed: ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; const preview = document.getElementById('next-slide'); if (preview) preview.innerHTML = index + 1 < doc.pages.length ? renderSvg(doc, index + 1) : '<p>End of presentation</p>'; }, [index, seconds, current]);
  useEffect(() => () => { presenter.current?.close(); }, []);
  const openPresenter = () => {
    const popup = window.open('', '', 'width=700,height=600'); if (!popup) return;
    presenter.current = popup; popup.document.title = 'Presenter notes';
    popup.document.body.style.cssText = 'font:20px system-ui;padding:32px;background:#18181b;color:#fafafa;line-height:1.6';
    const title = popup.document.createElement('h1'); title.textContent = 'Presenter view'; const content = popup.document.createElement('pre'); content.id = 'notes'; content.style.whiteSpace = 'pre-wrap'; content.textContent = current.notes ?? 'No speaker notes.';
    const preview = popup.document.createElement('div'); preview.id = 'next-slide'; preview.style.cssText = 'width:100%;max-width:480px'; const style = popup.document.createElement('style'); style.textContent = 'svg{width:100%;height:auto}button{padding:12px;margin-right:12px;font:inherit}'; popup.document.head.append(style);
    const prev = popup.document.createElement('button'); prev.textContent = 'Previous'; prev.onclick = () => setIndex(i => Math.max(0, i - 1)); const next = popup.document.createElement('button'); next.textContent = 'Next'; next.onclick = () => setIndex(i => Math.min(doc.pages.length - 1, i + 1)); popup.document.body.replaceChildren(title, prev, next, content, preview);
  };
  const pageView = (i: number) => <Slide key={doc.pages[i].id} doc={doc} index={i} time={i===index?motionTime:0} playback={i===index&&motionPlaying} navigate={id => go(doc.pages.findIndex(p => p.id === id))}/>;
  return <div ref={host} className="slide-player" style={{ position: close ? 'fixed' : 'relative', inset: 0, zIndex: 200, minHeight: '100vh', background: '#18181b', color: '#fafafa', fontFamily: 'system-ui', display: 'flex', flexDirection: 'column' }}>
    <style>{presentationStyles}</style><nav aria-label="Presentation controls" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', padding: 12 }}>
      {close && <button aria-label="Close presentation" title="Close presentation" onClick={close}><X size={18}/></button>}<button aria-label="Previous slide" disabled={!loop && index === 0} onClick={() => go(index - 1)}><ArrowLeft size={18}/></button><span aria-live="polite">{index + 1} / {doc.pages.length}</span><button aria-label="Next slide" disabled={!loop && index === doc.pages.length - 1} onClick={() => go(index + 1)}><ArrowRight size={18}/></button>
      <select aria-label="Presentation mode" value={mode} onChange={e => setMode(e.target.value as 'present' | 'overview' | 'read')}><option value="present">Present</option><option value="overview">Overview</option><option value="read">Reading</option></select>
      <button aria-label="Fullscreen" title="Fullscreen" onClick={() => host.current?.requestFullscreen?.().catch(() => {})}><Maximize size={18}/></button>{notes && <button title="Presenter window" onClick={openPresenter}><Monitor size={17}/>Presenter window</button>}
      {current.nodes.some(n=>n.character)&&<button onClick={()=>setMotionPlaying(p=>!p)}>{motionPlaying?'Pause motion':'Play motion'}</button>}<button onClick={() => play(!playing)}>{playing ? <Pause size={17}/> : <Play size={17}/>} {playing ? 'Pause' : 'Autoplay'}</button><label>Interval <input type="number" aria-label="Slide interval" min={1} max={600} value={interval} onChange={e => setIntervalSeconds(Math.max(1, Math.min(600, +e.target.value)))} style={{ width: 55 }}/></label><label><input type="checkbox" checked={loop} onChange={e => setLoop(e.target.checked)}/>Loop</label><button title="Blank screen (B)" aria-label="Blank screen" aria-pressed={blank} onClick={() => setBlank(v => !v)}>{blank ? <Eye size={17}/> : <EyeOff size={17}/>}</button><span>{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</span>
    </nav>
    <main style={{ flex: 1, display: 'grid', placeItems: 'center', overflow: 'auto', padding: 16 }} onTouchStart={e => { touch.current = e.touches[0].clientX; }} onTouchEnd={e => { const delta = e.changedTouches[0].clientX - touch.current; if (Math.abs(delta) > 60) go(index + (delta < 0 ? 1 : -1)); }}>
      {!blank && (mode === 'present' ? <div style={{ width: `min(100%, calc((100vh - 110px) * ${current.width / current.height}))`, overflow: 'hidden' }}>{pageView(index)}</div> : <div style={{ display: 'grid', gridTemplateColumns: mode === 'overview' ? 'repeat(auto-fit,minmax(260px,1fr))' : '1fr', gap: 24, width: '100%', maxWidth: 1400 }}>{doc.pages.map((p, i) => <div key={p.id} role="button" tabIndex={0} aria-label={`Go to slide ${i + 1}`} onClick={() => { go(i); setMode('present'); }} onKeyDown={e => { if (e.key === 'Enter') { go(i); setMode('present'); } }}>{pageView(i)}<p>{i + 1}. {p.name}</p></div>)}</div>)}
    </main>
  </div>;
}

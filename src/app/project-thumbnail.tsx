import { useEffect, useRef, useState } from 'react';
import { ImageOff, LoaderCircle } from 'lucide-react';
import type { Project } from '../shared/schema';
import { api } from './api';

// Serialize rasterization to avoid a project grid creating many WebGL contexts.
let queue = Promise.resolve();
const previews = new Map<string, string>();
const cacheLimit = 48;
function remember(key: string, src: string) {
  previews.delete(key); previews.set(key, src);
  if (previews.size > cacheLimit) previews.delete(previews.keys().next().value!);
}
export function ProjectThumbnail({ id, revision, name }: { id: string; revision: number; name: string }) {
  const host = useRef<HTMLDivElement>(null), [src, setSrc] = useState(''), [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true, started = false;
    const key = `${id}:${revision}`, cached = previews.get(key);
    setSrc(cached ?? ''); setFailed(false);
    if (cached) return;
    let observer: IntersectionObserver | undefined;
    const start = () => {
      if (started) return;
      started = true; observer?.disconnect();
      queue = queue.then(async () => {
        if (!active) return;
        try {
          const existing = previews.get(key);
          if (existing) { setSrc(existing); return; }
          const { project } = await api<{ project: Project }>(`/api/projects/${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(15000) });
          if (!active) return;
          const { mountExportPage, rasterizeExportPage } = await import('./export-page');
          // Motion covers should show the composition, not an empty opening fade.
          const time = (project.document.timeline?.duration ?? 0) / 2;
          const mounted = await mountExportPage(project.document, 0, time, true);
          try {
            const canvas = await rasterizeExportPage(mounted.host, 480, Math.max(1, Math.round(480 * project.document.pages[0].height / project.document.pages[0].width)));
            const rendered = canvas.toDataURL('image/webp', .8);
            remember(`${id}:${project.revision}`, rendered);
            if (active) setSrc(rendered);
          } finally { mounted.dispose(); }
        } catch { if (active) setFailed(true); }
      });
    };
    if (typeof IntersectionObserver === 'undefined') start();
    else {
      observer = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting)) start();
      }, { rootMargin: '150px' });
      if (host.current) observer.observe(host.current);
    }
    return () => { active = false; observer?.disconnect(); };
  }, [id, revision]);
  return <div className="project-snapshot" ref={host}>{src ? <img src={src} alt={`Preview of ${name}`} loading="lazy"/> : failed ? <span title="Preview could not load"><ImageOff size={22}/>Preview unavailable</span> : <LoaderCircle size={20} className="spin" aria-label="Loading project preview"/>}</div>;
}

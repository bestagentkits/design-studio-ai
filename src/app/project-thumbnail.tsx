import { useEffect, useRef, useState } from 'react';
import { ImageOff, LoaderCircle } from 'lucide-react';
import type { Project } from '../shared/schema';
import { api } from './api';

// Serialize rasterization to avoid a project grid creating many WebGL contexts.
let queue = Promise.resolve();
export function ProjectThumbnail({ id, revision, name }: { id: string; revision: number; name: string }) {
  const host = useRef<HTMLDivElement>(null), [src, setSrc] = useState(''), [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true, started = false;
    setSrc(''); setFailed(false);
    const observer = new IntersectionObserver(entries => {
      if (started || !entries.some(entry => entry.isIntersecting)) return;
      started = true; observer.disconnect();
      queue = queue.then(async () => {
        if (!active) return;
        try {
          const { project } = await api<{ project: Project }>(`/api/projects/${encodeURIComponent(id)}`);
          if (!active) return;
          const { mountExportPage } = await import('./export-page');
          const mounted = await mountExportPage(project.document, 0, 0, true);
          try {
            const { toCanvas } = await import('html-to-image');
            const canvas = await toCanvas(mounted.host, { canvasWidth: 480, canvasHeight: Math.max(1, Math.round(480 * project.document.pages[0].height / project.document.pages[0].width)), pixelRatio: 1, skipFonts: true });
            if (active) setSrc(canvas.toDataURL('image/webp', .8));
          } finally { mounted.dispose(); }
        } catch { if (active) setFailed(true); }
      });
    }, { rootMargin: '150px' });
    if (host.current) observer.observe(host.current);
    return () => { active = false; observer.disconnect(); };
  }, [id, revision]);
  return <div className="project-snapshot" ref={host}>{src ? <img src={src} alt={`Preview of ${name}`} loading="lazy"/> : failed ? <span title="Preview could not load"><ImageOff size={22}/>Preview unavailable</span> : <LoaderCircle size={20} className="spin" aria-label="Loading project preview"/>}</div>;
}

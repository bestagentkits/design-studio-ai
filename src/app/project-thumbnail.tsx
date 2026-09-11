import { useEffect, useRef, useState } from 'react';
import { ImageOff, LoaderCircle } from 'lucide-react';

export function ProjectThumbnail({ id, revision, thumbnailRevision, name }: { id: string; revision: number; thumbnailRevision?: number | null; name: string }) {
  const host = useRef<HTMLDivElement>(null);
  const imageUrl = (value: number) => `/api/projects/${encodeURIComponent(id)}/thumbnail?revision=${value}`;
  const [src, setSrc] = useState(() => thumbnailRevision ? imageUrl(thumbnailRevision) : '');
  const [failed, setFailed] = useState(false), [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true, started = false, objectUrl: string | undefined;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    setFailed(false);
    if (thumbnailRevision === revision && !retry) { setSrc(imageUrl(revision)); return; }
    const delay = () => new Promise<void>(resolve => { timer = setTimeout(resolve, 2000); });
    const load = async () => {
      if (started) return;
      started = true; observer?.disconnect();
      try {
        for (let attempt = 0; active && attempt < 60; attempt++) {
          const response = await fetch(imageUrl(revision), { credentials: 'same-origin', signal: controller.signal });
          if (response.status === 202) { await delay(); continue; }
          if (!response.ok || !response.headers.get('Content-Type')?.startsWith('image/')) throw new Error('Cover unavailable');
          objectUrl = URL.createObjectURL(await response.blob());
          const image = new Image(); image.src = objectUrl; await image.decode();
          if (active) setSrc(imageUrl(revision));
          return;
        }
        if (active) setFailed(true);
      } catch { if (active) setFailed(true); }
    };
    const observer = typeof IntersectionObserver === 'undefined' ? undefined : new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) void load();
    }, { rootMargin: '150px' });
    if (observer && host.current) observer.observe(host.current); else void load();
    return () => { active = false; controller.abort(); observer?.disconnect(); if (timer) clearTimeout(timer); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [id, revision, thumbnailRevision, retry]);
  return <div className="project-snapshot" ref={host}>
    {src ? <img src={src} alt={`Preview of ${name}`} loading="lazy" onError={() => { if (!retry) setRetry(1); else setFailed(true); }}/> : !failed && <LoaderCircle size={20} className="spin" aria-label="Loading project preview"/>}
    {failed && <span title="Preview unavailable. Reopen the workspace to retry."><ImageOff size={18}/>Preview unavailable</span>}
  </div>;
}

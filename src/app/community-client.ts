import { useEffect, useState } from 'react';
import { api, message, ApiError } from './api';
import type { CommunityJob } from '../shared/community';
export const communityKinds = [['web','Website'],['slides','Presentation'],['report','Document'],['wireframe','Wireframe'],['3d','3D scene'],['video','Motion']] as const;
export function kindLabel(kind: string) { return communityKinds.find(([id]) => id === kind)?.[1] || kind; }
export function fileSize(size: number) { return size < 1024 ? `${size} B` : size < 1048576 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1048576).toFixed(1)} MB`; }
export function formatLabel(format: string) { return format === 'package' ? 'Studio project package (.zip)' : format === 'react' ? 'React source (.zip)' : format.toUpperCase(); }
export function useCommunityEnabled() {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => { const controller = new AbortController(); void api<{ community?: { enabled: boolean } }>('/api/config', { signal: controller.signal }).then(data => setEnabled(data.community?.enabled === true)).catch(() => {}); return () => controller.abort(); }, []);
  return enabled;
}
export function storedCommunityImport(accountId: string, operationId?: string) {
  try { const key = `design-studio:community-import:${accountId}`; if (operationId === '') sessionStorage.removeItem(key); else if (operationId) sessionStorage.setItem(key, operationId); return sessionStorage.getItem(key); } catch { return null; }
}
export function useCommunityResource<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(!!path), [revision, setRevision] = useState(0);
  useEffect(() => {
    setData(null); setError(''); setLoading(!!path);
    if (!path) return;
    const controller = new AbortController();
    void api<T>(path, { signal: controller.signal }).then(value => { if (!controller.signal.aborted) setData(value); }).catch(error => { if (!controller.signal.aborted) setError(message(error)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [path, revision]);
  return { data, error, loading, reload: () => setRevision(value => value + 1) };
}
export function useCommunityJob(operationId: string | null) {
  const [job, setJob] = useState<CommunityJob | null>(null), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  useEffect(() => {
    setJob(null); setError('');
    if (!operationId) return;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>; let attempts = 0;
    const poll = async () => {
      try {
        const result = await api<{ job: CommunityJob }>(`/api/community/jobs/${encodeURIComponent(operationId)}`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setJob(result.job); setError('');
        if (result.job.status === 'queued' || result.job.status === 'running') timer = setTimeout(() => void poll(), Math.min(8000, 1200 + attempts++ * 300));
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.status === 404 && attempts++ < 10) { timer = setTimeout(() => void poll(), 1000); return; }
        setError(message(error));
      }
    };
    void poll(); return () => { controller.abort(); clearTimeout(timer); };
  }, [operationId, retry]);
  return { job, error, retry: () => setRetry(value => value + 1) };
}

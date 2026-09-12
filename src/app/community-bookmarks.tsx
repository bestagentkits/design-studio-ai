import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { CommunityListing } from '../shared/community';
import { api } from './api';
const Context = createContext<{ ids: Set<string>; update: (id: string, saved: boolean) => void }>({ ids: new Set(), update: () => {} });
export function CommunityBookmarks({ accountId, children }: { accountId?: string; children: ReactNode }) {
  const [ids,setIds]=useState(new Set<string>());
  useEffect(()=>{setIds(new Set());if(!accountId)return;const controller=new AbortController();void api<{listings:CommunityListing[]}>('/api/community/me/bookmarks',{signal:controller.signal}).then(data=>{if(!controller.signal.aborted)setIds(new Set(data.listings.map(item=>item.id)));}).catch(()=>{});return()=>controller.abort();},[accountId]);
  return <Context.Provider value={{ids,update:(id,saved)=>setIds(previous=>{const next=new Set(previous);if(saved)next.add(id);else next.delete(id);return next;})}}>{children}</Context.Provider>;
}
export function useCommunityBookmarks(){return useContext(Context);}

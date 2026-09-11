import { useEffect,useRef,useState } from 'react';
import { post,message } from './api';
let loading:Promise<void>|undefined;
function loadPicker(){
  return loading??=(async()=>{
    const state=globalThis as any;
    if(!state.gapi)await new Promise<void>((resolve,reject)=>{
      const script=document.createElement('script');script.src='https://apis.google.com/js/api.js';script.async=true;
      const timer=setTimeout(()=>{script.remove();reject(new Error('Google Picker could not load.'));},15000);
      script.onload=()=>{clearTimeout(timer);resolve();};script.onerror=()=>{clearTimeout(timer);script.remove();reject(new Error('Google Picker is unavailable.'));};document.head.append(script);
    });
    await new Promise<void>((resolve,reject)=>state.gapi.load('picker',{callback:resolve,onerror:()=>reject(new Error('Google Picker is unavailable.')),timeout:15000,ontimeout:()=>reject(new Error('Google Picker timed out.'))}));
  })().catch(error=>{loading=undefined;throw error;});
}
export function GoogleDrivePicker({connectionId,folders=false,onSelect}:{connectionId:string;folders?:boolean;onSelect:(ids:string[])=>Promise<void>}){
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const generation=useRef(0),active=useRef(true),cleanup=useRef<()=>void>(()=>{});
  useEffect(()=>{active.current=true;generation.current++;setBusy(false);setError('');return()=>{active.current=false;generation.current++;cleanup.current();};},[connectionId]);
  async function open(){
    const openedGeneration=generation.current;
    const current=()=>active.current&&generation.current===openedGeneration;
    setBusy(true);setError('');
    try{
      await loadPicker();if(!current())return;
      let access=await post<{accessToken:string;expiresAt:number;apiKey:string;appId:string}>('/api/connectors/google-drive/picker',{connectionId});
      if(!current()){access.accessToken='';return;}
      const google=(globalThis as any).google,pickerApi=google.picker;
      const view=new pickerApi.DocsView(pickerApi.ViewId.DOCS).setIncludeFolders(folders).setSelectFolderEnabled(folders);
      view.setMimeTypes(folders?'application/vnd.google-apps.folder':'application/vnd.google-apps.document,text/plain,text/markdown,application/json,application/pdf,image/png,image/jpeg,image/webp,image/gif');
      let picker:any,timer:ReturnType<typeof setTimeout>;
      const close=()=>{clearTimeout(timer);picker?.dispose();picker=null;access.accessToken='';if(current())setBusy(false);};cleanup.current=close;
      const builder=new pickerApi.PickerBuilder().addView(view).setOAuthToken(access.accessToken).setDeveloperKey(access.apiKey).setAppId(access.appId).setOrigin(location.origin).setCallback(async(data:any)=>{
        if(data.action===pickerApi.Action.CANCEL){close();return;}
        if(data.action!==pickerApi.Action.PICKED)return;
        const ids=(data.docs??[]).map((doc:any)=>doc.id);
        close();if(!current())return;
        setBusy(true);
        try{if(!ids.length||ids.length>100||ids.some((id:unknown)=>typeof id!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/.test(id)))throw new Error('Google returned an invalid file selection.');await onSelect(ids);}catch(e){if(current())setError(message(e));}finally{if(current())setBusy(false);}
      });
      if(!folders)builder.enableFeature(pickerApi.Feature.MULTISELECT_ENABLED);
      picker=builder.build();timer=setTimeout(close,Math.max(1,Math.min(access.expiresAt-Date.now(),600000)));picker.setVisible(true);
    }catch(e){if(current())cleanup.current();if(current()){setError(message(e));setBusy(false);}}
  }
  return <div className="connector-panel"><button type="button" className="button" disabled={busy} onClick={()=>void open()}>{busy?'Opening selected Google account…':folders?'Choose a Drive folder':'Choose Drive source files'}</button>{error&&<p role="alert" className="inline-error">{error}</p>}<small>Only files selected for this account are available. Choosing a folder does not grant access to its existing contents.</small></div>;
}

import type { Bindings } from '../types';
import type { ConnectionRow } from '../connection-store';
import type { ConnectorCredential } from '../connector-credentials';
import { connectorFingerprint } from '../connector-fingerprints';
import { withMcpClient } from './mcp-client';
import { readMcpCatalog } from './mcp-catalog';
type Catalog=Awaited<ReturnType<typeof readMcpCatalog>>;
const entries=new Map<string,{expires:number;catalog:Catalog}>();
/** Short-lived discovery optimization only. Dispatch always reloads definitions before claiming approval. */
export async function cachedMcpCatalog(env:Bindings,connection:ConnectionRow,credential:ConnectorCredential|undefined,partition:string,recheck:()=>Promise<void>){
  await recheck();
  const key=await connectorFingerprint({namespace:env.ENCRYPTION_KEY,origin:env.APP_URL,owner:connection.user_id,connection:connection.id,revision:connection.revision,endpoint:connection.endpoint,credential:credential??null,partition});
  const instant=Date.now();for(const [key,value] of entries)if(value.expires<=instant)entries.delete(key);
  const cached=entries.get(key);
  if(cached){await recheck();return structuredClone(cached.catalog);}
  const catalog=await withMcpClient(env,connection,credential,async scope=>{await recheck();return readMcpCatalog(scope);});
  await recheck();
  while(entries.size>=8)entries.delete(entries.keys().next().value!);
  entries.set(key,{expires:Date.now()+30000,catalog:structuredClone(catalog)});
  return catalog;
}

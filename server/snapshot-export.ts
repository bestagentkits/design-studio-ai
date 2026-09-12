import type { Bindings } from './types';
import type { DesignDocument } from '../src/shared/schema';
import { renderSnapshotExport, type SnapshotAssetResolver } from './exports';
import { exportOptionsSchema } from '../src/shared/export-contract';
import { remapDocumentAssets } from '../src/shared/document-asset-references';

/** Internal Community worker entry. Authorization and admission happen before rendering. */
export async function renderCommunitySnapshot(env: Bindings, document: DesignDocument, input: unknown, assetResolver: SnapshotAssetResolver, thumbnail = false, cover?:{pageIndex:number;time?:number;focalX:number;focalY:number}) {
  const selection=cover?{...cover,time:cover.time??0}:undefined;
  const options=exportOptionsSchema.parse(input);
  let portable=document;
  if(options.format==='json'){
    portable=structuredClone(document);const mapping=new Map<string,DesignDocument['assets'][number]>();let total=0;
    for(const asset of portable.assets){const resolved=await assetResolver(asset.url);total+=resolved.bytes.byteLength;if(total>20*1024*1024)throw new Error('JSON assets exceed the portable export budget. Use the design package.');mapping.set(asset.id,{...asset,url:`data:${resolved.mimeType};base64,${Buffer.from(resolved.bytes).toString('base64')}`});}
    remapDocumentAssets(portable,mapping);
  }
  const response = await renderSnapshotExport(env, portable.name, portable, options, assetResolver, {thumbnail,thumbnailSelection:selection});
  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    mimeType: response.headers.get('Content-Type') ?? 'application/octet-stream',
    filename: /filename="([^"]+)"/.exec(response.headers.get('Content-Disposition') ?? '')?.[1] ?? 'design',
  };
}

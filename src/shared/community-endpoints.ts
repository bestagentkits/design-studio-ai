import { z } from 'zod';
import { communityProfileGenerationSchema } from './community';
import { communityPreflightSchema, communityPublishSchema, communityUnlistSchema, communityRemixSchema, communityProfileSchema, communityReportSchema, communityResolveSchema, communityCollectionSchema, communityQuerySchema } from './community';

/** One operation inventory for REST discovery, MCP, WebMCP and the CLI. */
export const communityEndpoints = [
  { name:'taxonomy', method:'GET', path:'/taxonomy', summary:'Discover Community categories, formats and limits', public:true },
  { name:'search', method:'GET', path:'/listings', summary:'Search live community designs with category, tags, formats, sort and cursor filters', public:true, query:communityQuerySchema },
  { name:'get', method:'GET', path:'/listings/{id}', summary:'Read a live design and its download files', public:true },
  { name:'creator', method:'GET', path:'/creators/{handle}', summary:'Read a public creator profile', public:true },
  { name:'collections', method:'GET', path:'/collections', summary:'List curated Community collections', public:true },
  { name:'collection', method:'GET', path:'/collections/{id}', summary:'Read a curated Community collection', public:true },
  { name:'preview', method:'GET', path:'/listings/{id}/versions/{version}/preview', summary:'Get sandboxed HTML preview of a retained live version', public:true, binary:true },
  { name:'download', method:'GET', path:'/listings/{id}/versions/{version}/files/{fileId}', summary:'Download real ready file bytes; first eligible download contributes to creator impact', public:true, binary:true },
  { name:'preflight', method:'POST', path:'/preflight', summary:'Review the public projection, disclosures, formats and digest before publishing', body:communityPreflightSchema },
  { name:'publish', method:'POST', path:'/listings', summary:'Explicitly confirm CC-BY-4.0 and public disclosure to publish the reviewed revision; reuse exact operation ID and payload on retry', body:communityPublishSchema },
  { name:'release', method:'POST', path:'/listings/{id}/releases', summary:'Publish a new immutable release at the reviewed project and listing revisions', body:communityPublishSchema },
  { name:'unlist', method:'POST', path:'/listings/{id}/unlist', summary:'Revoke public access to all listing versions at the observed listing revision', body:communityUnlistSchema },
  { name:'job', method:'GET', path:'/jobs/{operationId}', summary:'Read your durable Community operation status and result' },
  { name:'job-preview', method:'GET', path:'/jobs/{operationId}/preview', summary:'Read your private staged publication preview', binary:true },
  { name:'job-file', method:'GET', path:'/jobs/{operationId}/files/{fileId}', summary:'Download your private staged file', binary:true },
  { name:'remix', method:'POST', path:'/listings/{id}/remix', summary:'Create an independent private project with owned assets and attribution from a pinned public version', body:communityRemixSchema },
  { name:'import', method:'POST', path:'/imports', summary:'Import a portable ZIP into an independent private project; operationId makes exact retries safe', upload:true },
  { name:'my-listings', method:'GET', path:'/me/listings', summary:'List your publications including private management states' },
  { name:'bookmarks', method:'GET', path:'/me/bookmarks', summary:'List your private saved Community designs' },
  { name:'impact', method:'GET', path:'/me/impact', summary:'Read server-confirmed creator impact and milestone badges' },
  { name:'profile', method:'GET', path:'/me/profile', summary:'Read your opt-in Community profile and revision' },
  { name:'set-profile', method:'PUT', path:'/me/profile', summary:'Create or update your public profile at its observed revision', body:communityProfileSchema },
  { name:'generate-profile', method:'POST', path:'/me/profile/generate', summary:'Use your configured text provider to suggest a public display name, handle and bio. Incurs provider usage; sends only supplied fields/instructions, defaults to your first configured text connection, and never saves or publishes. Review before set-profile; handle availability is checked again when saving.', body:communityProfileGenerationSchema },
  { name:'save', method:'PUT', path:'/listings/{id}/bookmark', summary:'Idempotently save a live design to your private bookmarks' },
  { name:'unsave', method:'DELETE', path:'/listings/{id}/bookmark', summary:'Idempotently remove a private bookmark' },
  { name:'report', method:'POST', path:'/listings/{id}/reports', summary:'Report a pinned design version with a reason and exact-retry operation ID', body:communityReportSchema },
  { name:'reports', method:'GET', path:'/moderation/reports', summary:'Operator session/API key only: list private reports', operator:true },
  { name:'moderation-collections', method:'GET', path:'/moderation/collections', summary:'Operator only: list collections including unavailable reviewed items', operator:true },
  { name:'report-detail', method:'GET', path:'/moderation/reports/{id}', summary:'Operator only: inspect a pinned report and content availability', operator:true },
  { name:'report-preview', method:'GET', path:'/moderation/reports/{id}/preview', summary:'Operator only: preview retained reported content', operator:true, binary:true },
  { name:'report-file', method:'GET', path:'/moderation/reports/{id}/files/{fileId}', summary:'Operator only: download retained evidence bound to the report', operator:true, binary:true },
  { name:'resolve-report', method:'POST', path:'/moderation/reports/{id}/resolve', summary:'Operator only: hide, restore or dismiss with observed report/listing revisions and a reason', body:communityResolveSchema, operator:true },
  { name:'create-collection', method:'POST', path:'/moderation/collections', summary:'Operator only: curate explicitly reviewed listing versions', body:communityCollectionSchema, operator:true },
  { name:'update-collection', method:'PUT', path:'/moderation/collections/{id}', summary:'Operator only: update ordered curation at the observed collection revision', body:communityCollectionSchema, operator:true },
] as const;

export interface CommunityEndpoint {
  name:string;method:string;path:string;summary:string;public?:boolean;operator?:boolean;
  body?:z.ZodType;query?:z.ZodType;binary?:boolean;upload?:boolean;
}
export function communityEndpointPath(endpoint:CommunityEndpoint, parameters:Record<string,unknown>={}, query:Record<string,unknown>={}) {
  const path='/api/community'+endpoint.path.replace(/\{(\w+)\}/g,(_,key:string)=>{
    const value=parameters[key];
    if(typeof value!=='string' && typeof value!=='number')throw new Error(`Missing path parameter: ${key}`);
    if(!String(value).length)throw new Error(`Missing path parameter: ${key}`);
    return encodeURIComponent(String(value));
  });
  const parsed=endpoint.query?endpoint.query.parse(query):query;
  const search=new URLSearchParams(Object.entries(parsed as Record<string,unknown>).filter(([,value])=>value!==undefined).map(([key,value])=>[key,String(value)]));
  return path+(search.size?`?${search}`:'');
}
export function communitySchemas() {
  return Object.fromEntries(communityEndpoints.filter((endpoint):endpoint is typeof endpoint & {body:z.ZodType}=>'body' in endpoint).map(endpoint=>[`${endpoint.method} /api/community${endpoint.path}`,z.toJSONSchema(endpoint.body,{io:'input'})]));
}

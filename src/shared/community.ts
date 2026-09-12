import { z } from 'zod';
import { kinds, type DesignDocument } from './schema';
import { exportOptionsSchema } from './export-contract';
import { textProviderSchema } from './providers';
export const communityIdSchema = z.string().min(1).max(120).regex(/^[a-zA-Z0-9_-]+$/);
export const communityOperationIdSchema = communityIdSchema.refine(value=>!value.startsWith('__community_'),'This operation ID prefix is reserved.');
export const communityFormatSchema = z.enum(['package', ...exportOptionsSchema.shape.format.options]);
export type CommunityFormat = z.infer<typeof communityFormatSchema>;
export const communitySortSchema = z.enum(['trending','newest','most-used','most-downloaded','relevance']);
export const communityTagSchema = z.string().trim().min(1).max(32).transform(v => v.normalize('NFC').toLowerCase());
export const communityMetadataSchema = z.object({ title: z.string().trim().min(1).max(200), description: z.string().trim().max(4000).default(''), tags: z.array(communityTagSchema).max(8).default([]).transform(v => [...new Set(v)]), formats: z.array(exportOptionsSchema.omit({expectedRevision:true})).max(16).default([]), cover: z.object({pageIndex:z.number().int().min(0).default(0), focalX:z.number().min(0).max(1).default(.5), focalY:z.number().min(0).max(1).default(.5),time:z.number().min(0).max(3600).default(0)}).strict().default({pageIndex:0,focalX:.5,focalY:.5,time:0}) }).strict();
export const communityPreflightSchema = communityMetadataSchema.extend({projectId:communityIdSchema,expectedProjectRevision:z.number().int().positive()}).strict();
export const communityPublishSchema = communityPreflightSchema.extend({operationId:communityOperationIdSchema,digest:z.string().min(20).max(128),license:z.literal('CC-BY-4.0'),acceptLicense:z.literal(true),confirmPublic:z.literal(true),expectedListingRevision:z.number().int().positive().optional()}).strict();
export const communityUnlistSchema = z.object({operationId:communityOperationIdSchema,expectedListingRevision:z.number().int().positive()}).strict();
export const communityRemixSchema = z.object({operationId:communityOperationIdSchema,version:z.number().int().positive()}).strict();
const reservedHandles = new Set(['admin','api','community','moderation','me','saved','publishing','support','studio','system','www']);
export const communityProfileSchema = z.object({handle:z.string().trim().toLowerCase().min(3).max(40).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).refine(v=>!reservedHandles.has(v),'This handle is reserved.'),displayName:z.string().trim().min(1).max(100),bio:z.string().trim().max(500).default(''),expectedProfileRevision:z.number().int().min(0)}).strict();
export const communityProfileSuggestionSchema = communityProfileSchema.omit({expectedProfileRevision:true}).extend({bio:z.string().trim().min(1).max(500)});
export type CommunityProfileSuggestion = z.infer<typeof communityProfileSuggestionSchema>;
export const communityProfileGenerationSchema = z.object({
  provider:textProviderSchema.optional(),
  displayName:z.string().trim().max(100).default(''),
  handle:z.string().trim().max(40).default(''),
  bio:z.string().trim().max(500).default(''),
  prompt:z.string().trim().max(1000).default(''),
}).strict();
export const communityQuerySchema = z.object({q:z.string().trim().max(200).default(''),kind:z.enum(kinds).optional(),tags:z.string().max(300).optional(),format:communityFormatSchema.optional(),period:z.enum(['all','week','month','year']).default('all'),creator:z.string().max(40).optional(),collection:communityIdSchema.optional(),sort:communitySortSchema.optional(),cursor:z.string().max(2000).optional(),limit:z.coerce.number().int().min(1).max(48).default(24)}).strict();
export const communityReportSchema = z.object({operationId:communityOperationIdSchema,version:z.number().int().positive(),reason:z.enum(['spam','harmful','ownership','privacy','other']),message:z.string().trim().min(1).max(2000)}).strict();
export const communityResolveSchema = z.object({operationId:communityOperationIdSchema,expectedReportRevision:z.number().int().positive(),expectedListingRevision:z.number().int().positive(),action:z.enum(['hide','restore','dismiss']),reason:z.string().trim().min(1).max(2000)}).strict();
export const communityCollectionSchema = z.object({title:z.string().trim().min(1).max(120),description:z.string().trim().max(1000).default(''),expectedCollectionRevision:z.number().int().min(0),items:z.array(z.object({listingId:communityIdSchema,version:z.number().int().positive(),reason:z.string().trim().min(1).max(500)}).strict()).max(100)}).strict();
export interface CommunityProfile {handle:string;displayName:string;bio:string;revision:number;badges:{badge:string;awardedAt:string}[]}
export interface CommunityFile {id:string;role:'asset'|'cover'|'download';format:CommunityFormat|null;mimeType:string;size:number;checksum:string;filename:string;url:string;options?:z.infer<typeof exportOptionsSchema>}
export interface CommunityListing {id:string;title:string;description:string;kind:DesignDocument['kind'];tags:string[];version:number;revision:number;creator:Pick<CommunityProfile,'handle'|'displayName'>;coverUrl:string|null;formats:CommunityFormat[];downloads:number;remixes:number;publishedAt:string|null;license:'CC-BY-4.0';pageCount:number;state?:'draft'|'live'|'unlisted'|'hidden'|'deleted';sourceProjectId?:string|null;moderationReason?:string|null;files?:CommunityFile[];previewUrl?:string;attribution?:CommunityAttribution|null;remixListings?:CommunityListing[];disclosure?:unknown}
export interface CommunityAttribution {listingId?:string;version?:number;title:string;creator:{handle:string;displayName:string};license:'CC-BY-4.0';url?:string;verified?:boolean;originalUnavailable?:boolean}
export interface CommunityJob {id:string;operationId:string;kind:string;status:'queued'|'running'|'succeeded'|'failed';stage:string;listingId:string|null;version:number|null;projectId?:string;error?:{code:string;message:string}|null;createdAt:string;updatedAt:string}
export interface CommunityPreflight {digest:string;document:DesignDocument;disclosure:unknown;kind:DesignDocument['kind'];pageCount:number;assetBytes:number;license:'CC-BY-4.0';formats:CommunityFormat[];availableFormats:CommunityFormat[];issues:{code:string;message:string}[]}
export interface CommunityCollection {id:string;title:string;description:string;revision:number;items:{listingId:string;version:number;reason:string;listing?:CommunityListing}[]}

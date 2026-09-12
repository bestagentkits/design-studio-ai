export function normalizeCommunityText(value:string) { return value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[đĐ]/g,'d').toLowerCase().normalize('NFC'); }
export function communitySearchTokens(value:string) { return normalizeCommunityText(value).match(/[\p{L}\p{N}]+/gu)?.slice(0,10) ?? []; }
export function communityFtsQuery(value:string) { return communitySearchTokens(value).map(token=>`"${token.replaceAll('"','""')}"*`).join(' AND '); }
export const COMMUNITY_TREND_WEIGHTS = {remix:4,download:1} as const;

import type { Bindings } from './types';
import { hash, now } from './security';

const values = (input?: string) => (input ?? '').split(',').map(value => value.trim()).filter(Boolean);
const configuredEmails = (env: Bindings) => new Set(values(env.COMMUNITY_ADMIN_EMAILS).map(email => email.toLowerCase()));

/** Only call with email identities verified directly by the identity provider. */
export async function claimCommunityAdminEmails(env: Bindings, userId: string, verifiedEmails: string[]) {
  const allowed = configuredEmails(env);
  for (const email of new Set(verifiedEmails.map(value => value.trim().toLowerCase()))) {
    if (!allowed.has(email)) continue;
    await env.DB.prepare('INSERT INTO community_admin_claims(email_hash,user_id,verified_at) VALUES(?,?,?) ON CONFLICT(email_hash) DO UPDATE SET user_id=excluded.user_id,verified_at=excluded.verified_at')
      .bind(await hash(email), userId, now()).run();
  }
}

export async function isCommunityAdmin(env: Bindings, userId: string): Promise<boolean> {
  if (values(env.COMMUNITY_ADMIN_IDS).includes(userId)) return true;
  const emails = [...configuredEmails(env)];
  if (!emails.length) return false;
  const hashes = await Promise.all(emails.map(email => hash(email)));
  const claim = await env.DB.prepare(`SELECT 1 FROM community_admin_claims WHERE user_id=? AND email_hash IN (${hashes.map(() => '?').join(',')}) LIMIT 1`).bind(userId, ...hashes).first();
  return !!claim;
}

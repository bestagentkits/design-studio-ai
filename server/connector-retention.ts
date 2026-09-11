import type { Bindings } from './types';
import { now } from './security';

/** Bounded request/startup maintenance; no background continuation or secret-bearing telemetry. */
export async function maintainConnectorState(env: Bindings) {
  const instant = Date.now(), timestamp = now();
  await env.DB.batch([
    env.DB.prepare("UPDATE agent_runs SET status='outcome_unknown',revision=revision+1,lease_id=NULL,lease_expires_at=NULL,updated_at=?,payload_expires_at=? WHERE id IN(SELECT id FROM agent_runs WHERE status='running' AND lease_expires_at<=? LIMIT 100)").bind(timestamp,instant+7*86400000,instant),
    env.DB.prepare("UPDATE run_steps SET status='outcome_unknown',revision=revision+1,lease_id=NULL,lease_expires_at=NULL,updated_at=?,payload_expires_at=? WHERE id IN(SELECT id FROM run_steps WHERE status='running' AND lease_expires_at<=? LIMIT 100)").bind(timestamp,instant+7*86400000,instant),
    env.DB.prepare(`UPDATE connector_operations SET status='outcome_unknown',revision=revision+1,lease_id=NULL,lease_expires_at=NULL,error_code='outcome_unknown',updated_at=?,payload_expires_at=?
      WHERE id IN(SELECT id FROM connector_operations WHERE status='running' AND lease_expires_at<=? LIMIT 100)`).bind(timestamp,instant+7*86400000,instant),
    env.DB.prepare('DELETE FROM connection_auth_states WHERE state_hash IN(SELECT state_hash FROM connection_auth_states WHERE expires_at<=? LIMIT 100)').bind(instant),
    env.DB.prepare(`UPDATE connections SET status='needs_reauthorization',revision=revision+1,updated_at=? WHERE status='connected'
      AND id IN(SELECT connection_id FROM connection_credentials WHERE refresh_lease_id IS NOT NULL AND refresh_lease_expires_at<=? LIMIT 100)`).bind(timestamp, instant),
    env.DB.prepare(`UPDATE connector_operations SET encrypted_arguments=NULL WHERE id IN(
      SELECT id FROM connector_operations WHERE payload_expires_at<=? AND encrypted_arguments IS NOT NULL AND status IN('succeeded','failed','cancelled','outcome_unknown') LIMIT 100)`).bind(instant),
    env.DB.prepare(`UPDATE agent_runs SET encrypted_payload=NULL WHERE id IN(
      SELECT id FROM agent_runs WHERE payload_expires_at<=? AND encrypted_payload IS NOT NULL AND status IN('succeeded','failed','cancelled','outcome_unknown') LIMIT 100)`).bind(instant),
    env.DB.prepare(`UPDATE run_steps SET encrypted_payload=NULL WHERE id IN(
      SELECT id FROM run_steps WHERE payload_expires_at<=? AND encrypted_payload IS NOT NULL AND status IN('succeeded','failed','cancelled','outcome_unknown') LIMIT 100)`).bind(instant),
  ]);
}

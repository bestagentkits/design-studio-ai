/** Trusted internal predicates only. Pack scalar pins to stay within D1's parameter limit. */
export function compactConnectorGuard(guard:{sql:string;values:unknown[]}){
  let index=0;
  const sql=guard.sql.replace(/\?/g,()=>`json_extract(connector_guard_values.payload,'$[${index++}]')`);
  if(index!==guard.values.length)throw new Error('Connector guard parameter count mismatch');
  return {sql:`EXISTS(SELECT 1 FROM (SELECT ? AS payload) connector_guard_values WHERE (${sql}))`,values:[JSON.stringify(guard.values)]};
}

import { prepareGithubExport,executeGithubExport } from './connectors/github-export';
import type { Context } from 'hono';
import type { Env } from './types';
import type { Bindings } from './types';
import type { ConnectorPrincipal } from '../src/shared/connector-values';
import { connectorOperationPrepareSchema } from '../src/shared/connector-operations';
import { ownedBinding } from './connection-policy';
import { ownedOperation } from './connector-operation-versions';
import { connectorSelectionSchema } from '../src/shared/connectors';
import { prepareMcpToolOperation,executeMcpToolOperation } from './connectors/mcp-tools';
import { prepareGoogleOperation,executeGoogleOperation } from './connectors/google-tools';
import { fail } from './security';
export async function prepareConnectorAction(env:Bindings,principal:ConnectorPrincipal,projectId:string,input:unknown,c?:Context<Env>){
  const value=connectorOperationPrepareSchema.parse(input),binding=await ownedBinding(env,principal.userId,value.bindingId);
  const selection=connectorSelectionSchema.parse(JSON.parse(binding.selection_json));
  if(selection.adapter==='github')return prepareGithubExport(env,principal,projectId,value,c);
  if(selection.adapter==='mcp')return prepareMcpToolOperation(env,principal,projectId,value);
  if(selection.adapter==='google-drive')return prepareGoogleOperation(env,principal,projectId,value,c);
  fail(400,'unsupported_action','This adapter does not expose actions yet.');
}
export async function executeConnectorAction(env:Bindings,principal:ConnectorPrincipal,projectId:string,operationId:string,expectedRevision:number,guard?:{sql:string;values:unknown[]}){
  const operation=await ownedOperation(env,principal.userId,operationId),binding=await ownedBinding(env,principal.userId,operation.binding_id);
  const selection=connectorSelectionSchema.parse(JSON.parse(binding.selection_json));
  if(selection.adapter==='github')return executeGithubExport(env,principal,projectId,operationId,expectedRevision,guard);
  if(selection.adapter==='mcp')return executeMcpToolOperation(env,principal,projectId,operationId,expectedRevision,guard);
  if(selection.adapter==='google-drive')return executeGoogleOperation(env,principal,projectId,operationId,expectedRevision,guard);
  fail(400,'unsupported_action','This adapter does not expose actions yet.');
}

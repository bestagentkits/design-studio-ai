import { z } from 'zod';
import { boundedConnectorJson } from '../src/shared/connector-values';
import { connectorFingerprint } from './connector-fingerprints';
export const dispatchContextSchema=z.strictObject({
  kind:z.literal('mcp-continuation'),requestState:z.string().max(16000).optional(),
  inputResponses:boundedConnectorJson(16000),
});
export type DispatchContext=z.infer<typeof dispatchContextSchema>;
export const operationArgumentsHash=(argumentsValue:unknown,context?:DispatchContext)=>connectorFingerprint(context?{arguments:argumentsValue,dispatchContext:context}:argumentsValue);

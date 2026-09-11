import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { connectorAgentContracts, connectorAgentRequest } from '../src/shared/connector-agent-contracts';
export function registerConnectorAgentTools(server:McpServer,call:(method:string,path:string,body?:unknown,binary?:boolean)=>Promise<any>){
  for(const contract of connectorAgentContracts)server.registerTool(contract.name,{
    description:contract.description,inputSchema:contract.input.shape,
    annotations:{readOnlyHint:contract.method==='GET',openWorldHint:contract.method!=='GET'},
  },async input=>{const request=connectorAgentRequest(contract,input);return call(contract.method,request.path,request.body,contract.binary);});
}

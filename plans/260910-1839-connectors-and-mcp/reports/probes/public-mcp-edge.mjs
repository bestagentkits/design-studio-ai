import { withMcpClient } from '../../../../server/connectors/mcp-client.ts';
import { readMcpCatalog } from '../../../../server/connectors/mcp-catalog.ts';
import { createWorkersConnectorFetch } from '../../../../server/connector-transport.ts';
// Fixed public documentation target and query. No credentials, private bindings or caller-supplied destinations.
export default {async fetch(){
  try{
    const result=await withMcpClient({CONNECTOR_FETCH:createWorkersConnectorFetch()},{id:'public-documentation-probe',adapter:'mcp',endpoint:'https://docs.mcp.cloudflare.com/mcp',status:'connected',auth_mode:'anonymous'},undefined,async scope=>{
      const catalog=await readMcpCatalog(scope);
      const result=await scope.client.request({method:'tools/call',params:{name:'search_cloudflare_documentation',arguments:{query:'Workers global_fetch_strictly_public public Internet fetch'}}},scope.requestOptions);
      const text=(result.content??[]).filter(item=>item.type==='text').map(item=>item.text).join('\n');
      if(result.isError||!text.length)throw new Error('Documentation search did not return content');
      return {profile:scope.client.getNegotiatedProtocolVersion(),tools:catalog.tools.map(tool=>tool.remoteName),textBytes:new TextEncoder().encode(text).length,isError:false};
    });
    return Response.json(result);
  }catch(error){return Response.json({code:error.code??'probe_failed',message:error.message},{status:500});}
}};

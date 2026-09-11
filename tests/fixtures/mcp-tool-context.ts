import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { setup } from './connector-operation-context';
import { prepareMcpToolOperation, executeMcpToolOperation } from '../../server/connectors/mcp-tools';
const pins = {connectionRevision:1,credentialVersion:1,policyRevision:1,documentRevision:1,briefRevision:0,sourceSnapshotIds:[]};
export const input = {bindingId:'binding',action:'action',arguments:{text:'reviewed payload'},idempotencyKey:'mcp-operation-key-001',expectedVersions:pins};
export async function fixture(t:TestContext) {
  const f = await setup(t), methods:string[]=[], calls:Record<string,unknown>[]=[];
  const state: {description:string;mode:'success'|'error'|'drop'|'input';hook?: (method:string)=>Promise<void>} = {description:'Reviewed remote action',mode:'success'};
  const server=createServer(async(req,res)=>{
    const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));
    const rpc=JSON.parse(Buffer.concat(chunks).toString());methods.push(rpc.method);
    await state.hook?.(rpc.method);
    let result:object;
    if(rpc.method==='server/discover')result={supportedVersions:['2026-07-28'],capabilities:{tools:{}}};
    else if(rpc.method==='tools/list')result={tools:[{name:'action',description:state.description,inputSchema:{type:'object',properties:{text:{type:'string'}},required:['text'],additionalProperties:false},annotations:{readOnlyHint:true}}]};
    else {
      assert.equal(rpc.method,'tools/call');calls.push(rpc.params);assert.deepEqual(rpc.params.arguments,input.arguments);
      if(state.mode==='drop'){res.destroy();return;}
      if(state.mode==='input'){res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({jsonrpc:'2.0',id:rpc.id,result:{resultType:'input_required',requestState:'private-continuation'}}));return;}
      result={content:[{type:'text',text:'private remote result'}],...(state.mode==='error'?{isError:true}:{})};
    }
    res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({jsonrpc:'2.0',id:rpc.id,result:{...result,resultType:'complete',ttlMs:0,cacheScope:'private'}}));
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{const closed=new Promise<void>(resolve=>server.close(()=>resolve()));server.closeAllConnections();await closed;});
  f.env.CONNECTOR_FETCH=async(input,init)=>{
    const request=new Request(input,init);assert.equal(request.url,'https://peer.vendor.net/mcp');assert.equal(request.headers.has('authorization'),false);
    return fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}`,{method:request.method,headers:request.headers,body:request.body,signal:request.signal,duplex:'half'} as RequestInit);
  };
  const prepare=()=>prepareMcpToolOperation(f.env,f.api,'alice-project',input);
  const approve=async()=>{const op=await prepare();assert.equal(op.status,'awaiting_approval');assert.equal((await f.decision(op.id)).status,200);return op.id;};
  const execute=(id:string)=>executeMcpToolOperation(f.env,f.api,'alice-project',id,2);
  return {...f,methods,calls,state,prepare,approve,execute};
}

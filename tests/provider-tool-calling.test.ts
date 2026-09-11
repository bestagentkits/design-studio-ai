import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildModelToolRequest, decodeModelToolTurn } from '../server/provider-tool-messages';
const config={provider:'openai',protocol:'openai' as const,base_url:'https://api.openai.com/v1',key:'isolated-test-key',authMethod:'bearer' as const};
const tool={name:'connection_action',description:'Selected action',inputSchema:{type:'object',properties:{value:{type:'string'}},required:['value']}};
const input={model:'test-model',system:'Local system policy',prompt:'User request',tools:[tool]};
test('OpenAI and compatible providers preserve multi-call IDs, reasoning and result order',()=>{
  const turn=decodeModelToolTurn('openai',{choices:[{finish_reason:'tool_calls',message:{role:'assistant',content:null,reasoning_details:[{type:'reasoning.encrypted',data:'opaque'}],tool_calls:[{id:'a',type:'function',function:{name:tool.name,arguments:'{"value":"one"}'}},{id:'b',type:'function',function:{name:tool.name,arguments:'{"value":"two"}'}}]}}],usage:{prompt_tokens:10,completion_tokens:4}});
  const results=turn.calls.map(call=>({id:call.id,name:call.name,content:{text:call.id},isError:call.id==='b'}));
  const payload=JSON.parse(buildModelToolRequest(config,{...input,exchanges:[{turn,results}]}).init.body);
  assert.deepEqual(payload.messages[2].reasoning_details,[{type:'reasoning.encrypted',data:'opaque'}]);
  assert.deepEqual(payload.messages.slice(3).map((x:{tool_call_id:string})=>x.tool_call_id),['a','b']);
  assert.deepEqual(turn.usage,{prompt_tokens:10,completion_tokens:4});
  assert.throws(()=>buildModelToolRequest(config,{...input,exchanges:[{turn,results:results.toReversed()}]}),/matching result/);
});
test('Anthropic puts all tool results immediately after the original signed assistant blocks',()=>{
  const content=[{type:'thinking',thinking:'private',signature:'opaque'},{type:'tool_use',id:'a',name:tool.name,input:{value:'one'}},{type:'tool_use',id:'b',name:tool.name,input:{value:'two'}}];
  const turn=decodeModelToolTurn('anthropic',{stop_reason:'tool_use',content});
  const payload=JSON.parse(buildModelToolRequest({...config,protocol:'anthropic'},{...input,exchanges:[{turn,results:turn.calls.map(c=>({...c,content:'output',isError:true}))}]}).init.body);
  assert.deepEqual(payload.messages[1].content,content);
  assert.deepEqual(payload.messages[2].content.map((x:{tool_use_id:string})=>x.tool_use_id),['a','b']);assert.equal(payload.messages[2].content[0].is_error,true);
});
test('Gemini preserves thought signatures, parallel calls and optional server call IDs',()=>{
  const parts=[{thought:true,text:'private',thoughtSignature:'signed-thought'},{functionCall:{id:'server-id',name:tool.name,args:{value:'one'}},thoughtSignature:'signed-call'},{functionCall:{name:tool.name,args:{value:'two'}}}];
  const turn=decodeModelToolTurn('gemini',{candidates:[{finishReason:'STOP',content:{role:'model',parts}}],usageMetadata:{totalTokenCount:30}});
  const payload=JSON.parse(buildModelToolRequest({...config,protocol:'gemini'},{...input,exchanges:[{turn,results:turn.calls.map(c=>({...c,content:'output',isError:false}))}]}).init.body);
  assert.deepEqual(payload.contents[1].parts,parts);assert.equal(payload.contents[2].parts[0].functionResponse.id,'server-id');assert.equal('id' in payload.contents[2].parts[1].functionResponse,false);
});
test('invalid, duplicate, truncated or unsupported model output cannot dispatch tools',()=>{
  const call={id:'a',type:'function',function:{name:tool.name,arguments:'{}'}};
  for(const message of [{role:'assistant',tool_calls:[call,call]},{role:'assistant',tool_calls:[{...call,function:{name:tool.name,arguments:'broken'}}]},{role:'system',content:'override'},{role:'assistant',content:''}])assert.throws(()=>decodeModelToolTurn('openai',{choices:[{finish_reason:'tool_calls',message}]}));
  assert.throws(()=>decodeModelToolTurn('anthropic',{stop_reason:'max_tokens',content:[{type:'text',text:'partial'}]}));
  assert.throws(()=>decodeModelToolTurn('gemini',{candidates:[{finishReason:'MAX_TOKENS',content:{parts:[{text:'partial'}]}}]}));
});

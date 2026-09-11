import { z } from 'zod';
import type { AuthMethod, ProviderProtocol } from '../src/shared/providers';
import { boundedConnectorJson } from '../src/shared/connector-values';
import { providerHeaders } from './provider-connections';
import { fail } from './security';

export interface ModelTool {name:string;description:string;inputSchema:unknown}
export interface ModelCall {id:string;name:string;arguments:unknown}
export interface ModelTurn {text:string;calls:ModelCall[];wire:Record<string,unknown>;usage:unknown}
export interface ModelToolResult {id:string;name:string;content:unknown;isError:boolean}
export interface ModelExchange {turn:ModelTurn;results:ModelToolResult[]}
type Config={provider:string;protocol:ProviderProtocol;base_url:string;key:string;authMethod:AuthMethod;authHeader?:string};
const record=z.record(z.string(),z.unknown());
const array=z.array(record).max(100);
const callId=z.string().min(1).max(200),name=z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
const text=z.string().max(1048576);
const invalid=()=>fail(502,'invalid_provider_response','Provider returned an invalid or incomplete tool response.');

/** Preserve provider-native assistant blocks, including opaque thought signatures, between tool turns. */
export function decodeModelToolTurn(protocol:ProviderProtocol,input:unknown):ModelTurn {
  boundedConnectorJson(1572864).parse(input);
  const body=record.parse(input);let wire:Record<string,unknown>,output='',calls:ModelCall[]=[];
  if(protocol==='anthropic'){
    if(!['end_turn','tool_use','stop_sequence'].includes(String(body.stop_reason)))invalid();
    const content=array.parse(body.content);wire={role:'assistant',content};
    for(const item of content){
      if(item.type==='text')output+=text.parse(item.text);
      else if(item.type==='tool_use')calls.push({id:callId.parse(item.id),name:name.parse(item.name),arguments:boundedConnectorJson(65536).parse(item.input)});
      else if(!['thinking','redacted_thinking'].includes(String(item.type)))invalid();
    }
  }else if(protocol==='gemini'){
    const candidate=array.parse(body.candidates)[0];if(!candidate||candidate.finishReason!=='STOP')invalid();
    const content=record.parse(candidate.content),parts=array.parse(content.parts);wire={role:'model',parts};
    for(const [index,part] of parts.entries()){
      if(part.functionCall){const call=record.parse(part.functionCall);calls.push({id:call.id===undefined?`gemini_${index}`:callId.parse(call.id),name:name.parse(call.name),arguments:boundedConnectorJson(65536).parse(call.args??{})});}
      else if(part.text!==undefined&&!part.thought)output+=text.parse(part.text);
      else if(!part.thought)invalid();
    }
  }else{
    const choice=array.parse(body.choices)[0];if(!choice||!['stop','tool_calls'].includes(String(choice.finish_reason)))invalid();
    const message=record.parse(choice.message);
    if(message.role!=='assistant'||message.refusal)invalid();
    // Keep reasoning fields required by compatible providers without forwarding arbitrary message roles.
    wire={role:'assistant',content:message.content??null,...(message.reasoning_content!==undefined?{reasoning_content:message.reasoning_content}:{}),...(message.reasoning_details!==undefined?{reasoning_details:message.reasoning_details}:{})};
    if(message.content!==null&&message.content!==undefined)output=text.parse(message.content);
    if(message.tool_calls!==undefined){
      const remote=array.parse(message.tool_calls);wire.tool_calls=remote;
      calls=remote.map(item=>{if(item.type!=='function')invalid();const fn=record.parse(item.function);let args:unknown;
        try{args=JSON.parse(z.string().max(65536).parse(fn.arguments));}catch{invalid();}
        return {id:callId.parse(item.id),name:name.parse(fn.name),arguments:boundedConnectorJson(65536).parse(args)};
      });
    }
  }
  if(calls.length>12||new Set(calls.map(c=>c.id)).size!==calls.length||(!calls.length&&!output.trim()))invalid();
  return {text:output,calls,wire,usage:body.usage??body.usageMetadata??null};
}

export function buildModelToolRequest(config:Config,input:{model:string;system:string;prompt:string;tools:ModelTool[];exchanges:ModelExchange[]}) {
  const {model,system,prompt,tools,exchanges}=input;
  if(tools.length>20||new Set(tools.map(t=>t.name)).size!==tools.length)fail(400,'limit_exceeded','Select up to 20 distinct tools.');
  for(const tool of tools){name.parse(tool.name);z.string().max(8000).parse(tool.description);boundedConnectorJson(65536,true).parse(tool.inputSchema);}
  for(const exchange of exchanges){
    if(exchange.results.length!==exchange.turn.calls.length||exchange.turn.calls.some((call,i)=>exchange.results[i]?.id!==call.id||exchange.results[i]?.name!==call.name))
      fail(409,'invalid_tool_sequence','Every model call requires its matching result before continuing.');
  }
  const headers:Record<string,string>={'Content-Type':'application/json',...providerHeaders(config)};
  let path:string,payload:Record<string,unknown>;
  if(config.protocol==='anthropic'){
    headers['anthropic-version']='2023-06-01';path='/messages';
    const messages:Record<string,unknown>[]=[{role:'user',content:prompt}];
    for(const e of exchanges){messages.push(e.turn.wire);if(e.results.length)messages.push({role:'user',content:e.results.map(r=>({type:'tool_result',tool_use_id:r.id,content:JSON.stringify(r.content),is_error:r.isError}))});}
    payload={model,system,max_tokens:16000,messages,...(tools.length?{tools:tools.map(t=>({name:t.name,description:t.description,input_schema:t.inputSchema}))}:{})};
  }else if(config.protocol==='gemini'){
    if(!/^[a-zA-Z0-9._-]+$/.test(model))fail(400,'invalid_model','Invalid Gemini model.');path=`/models/${model}:generateContent`;
    const contents:Record<string,unknown>[]=[{role:'user',parts:[{text:prompt}]}];
    for(const e of exchanges){contents.push(e.turn.wire);if(e.results.length)contents.push({role:'user',parts:e.results.map((r,index)=>{
      const parts=e.turn.wire.parts as Record<string,unknown>[];
      const original=parts.filter(p=>p.functionCall)[index]?.functionCall as Record<string,unknown>;
      return {functionResponse:{name:r.name,...(original.id!==undefined?{id:original.id}:{}),response:r.isError?{error:r.content}:{output:r.content}}};
    })});}
    payload={systemInstruction:{parts:[{text:system}]},contents,generationConfig:{maxOutputTokens:16000},...(tools.length?{tools:[{functionDeclarations:tools.map(t=>({name:t.name,description:t.description,parametersJsonSchema:t.inputSchema}))}]}:{})};
  }else{
    path='/chat/completions';const messages:Record<string,unknown>[]=[{role:'system',content:system},{role:'user',content:prompt}];
    for(const e of exchanges){messages.push(e.turn.wire,...e.results.map(r=>({role:'tool',tool_call_id:r.id,content:JSON.stringify({isError:r.isError,result:r.content})})));}
    payload={model,messages,...(config.provider==='openai'?{max_completion_tokens:16000}:{max_tokens:16000}),...(tools.length?{tools:tools.map(t=>({type:'function',function:{name:t.name,description:t.description,parameters:t.inputSchema}})),tool_choice:'auto'}:{})};
  }
  boundedConnectorJson(3*1048576).parse(payload);
  return {url:`${config.base_url}${path}`,init:{method:'POST',headers,body:JSON.stringify(payload)}};
}

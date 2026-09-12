import type { Command } from 'commander';
import { readFile, stat } from 'node:fs/promises';
import { communityEndpoints, communityEndpointPath, communitySchemas, type CommunityEndpoint } from '../../../src/shared/community-endpoints';
import { Client, CliError, inputJson, output, outputFile } from './client';
export function registerCommunityCommands(program:Command,client:()=>Client) {
  const community=program.command('community').description('Publish, discover, download and remix Community designs');
  community.command('schema').description('Canonical request schemas and endpoints').action(()=>output({schemas:communitySchemas(),operations:communityEndpoints.map(({name,method,path,summary})=>({name,method,path,summary}))}));
  for(const endpoint of communityEndpoints as readonly CommunityEndpoint[]) {
    const parameters=[...endpoint.path.matchAll(/\{(\w+)\}/g)].map(match=>match[1]);
    const command=community.command([endpoint.name,...parameters.map(name=>`<${name}>`)].join(' ')).description(endpoint.summary);
    if(endpoint.body)command.requiredOption('--file <path>','Request JSON file or - for stdin; includes observed revisions and confirmation where required');
    if(endpoint.query)for(const key of ['q','kind','tags','format','period','creator','collection','sort','cursor','limit'])command.option(`--${key} <value>`,`Community ${key} filter`);
    if(endpoint.binary)command.requiredOption('--out <path>','Output file; - writes raw bytes to stdout');
    if(endpoint.upload)command.requiredOption('--file <path>','Portable ZIP file, up to 20 MiB').requiredOption('--operation-id <id>','Stable operation ID; reuse only with identical bytes');
    command.action(async(...args:any[])=>{
      const values=Object.fromEntries(parameters.map((name,index)=>[name,args[index]]));
      const options=args[parameters.length] as Record<string,string>;
      const query=endpoint.query?Object.fromEntries(Object.entries(options).filter(([key])=>!['out','file','operationId'].includes(key))):{};
      const path=communityEndpointPath(endpoint,values,query);
      let body:unknown=endpoint.body?endpoint.body.parse(await inputJson(options.file)):undefined;
      if(endpoint.upload){if((await stat(options.file)).size>20*1024*1024)throw new CliError('package_too_large','Community packages must not exceed 20 MiB.');const bytes=await readFile(options.file);const form=new FormData();form.set('file',new Blob([bytes],{type:'application/zip'}),'design.zip');form.set('operationId',options.operationId);body=form;}
      if(endpoint.binary){const response=await client().request(path,endpoint.method,body,!endpoint.public);await outputFile(options.out,new Uint8Array(await response.arrayBuffer()),{mimeType:response.headers.get('Content-Type')});}
      else output(await client().json(path,endpoint.method,body,!endpoint.public));
    });
  }
}

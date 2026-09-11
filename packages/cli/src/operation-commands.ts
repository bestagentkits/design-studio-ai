import type {Command} from 'commander';
import {Client,inputJson,output,outputFile} from './client';
import {operationJobSchema} from '../../../src/shared/operation-jobs';
export function registerOperationCommands(program:Command,client:()=>Client){
 const group=program.command('operations').description('Durable save/export jobs; retain the request ID to recover interrupted clients');
 const path=(project:string,id?:string)=>`/api/projects/${encodeURIComponent(project)}/operations${id?'/'+encodeURIComponent(id):''}`;
 group.command('start <projectId>').requiredOption('--file <path>','Job JSON with stable operationId; - for stdin').action(async(projectId,options)=>output(await client().json(path(projectId),'POST',operationJobSchema.parse(await inputJson(options.file)))));
 group.command('status <projectId> <operationId>').action(async(projectId,id)=>output(await client().json(path(projectId,id))));
 group.command('result <projectId> <operationId>').requiredOption('--out <path>','Output file').action(async(projectId,id,options)=>{const response=await client().request(path(projectId,id)+'/result');await outputFile(options.out,new Uint8Array(await response.arrayBuffer()),{operationId:id});});
}

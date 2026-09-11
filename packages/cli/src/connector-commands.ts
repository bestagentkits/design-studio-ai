import type { Command } from 'commander';
import { connectorAgentContracts, connectorAgentRequest } from '../../../src/shared/connector-agent-contracts';
import { Client, inputJson, output, outputFile } from './client';
export function registerConnectorCommands(program:Command,client:()=>Client){
  const group=program.command('connectors').description('Explicitly granted project tools, sources and persisted runs. Connect accounts and approve writes in Studio.');
  group.command('schema <command>').description('Show exact shared request schema').action(name=>{
    const contract=connectorAgentContracts.find(item=>item.name.replaceAll('_','-')===name);
    if(!contract)throw new Error('Unknown connector command. See connectors --help.');
    output(contract.input.toJSONSchema());
  });
  for(const contract of connectorAgentContracts){
    const command=group.command(contract.name.replaceAll('_','-')).description(contract.description).requiredOption('--file <path>','Request JSON, or - for stdin');
    if(contract.binary)command.requiredOption('--output <path>','Write source bytes to this file');
    command.action(async options=>{
      const request=connectorAgentRequest(contract,await inputJson(options.file));
      if(contract.binary){const response=await client().request(request.path,contract.method,request.body);await outputFile(options.output,new Uint8Array(await response.arrayBuffer()),{mimeType:response.headers.get('Content-Type')});}
      else output(await client().json(request.path,contract.method,request.body));
    });
  }
}

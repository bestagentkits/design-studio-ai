import type { Command } from 'commander';
import { sceneRequestSchema, sceneCommandSchema } from '../../../src/shared/scene-authoring-schema';
import { Client, inputJson, output } from './client';
import { z } from 'zod';
export function registerSceneCommands(program:Command,client:()=>Client){
  const group=program.command('scene').description('Inspect, preview and author editable 3D characters');
  group.command('scan <projectId>').requiredOption('--page <id>','Page ID').option('--samples <count>','2 to 61 poses','25').action(async(projectId,options)=>{const samples=z.coerce.number().int().min(2).max(61).parse(options.samples);output(await client().json(`/api/projects/${encodeURIComponent(projectId)}/scene/animation?${new URLSearchParams({pageId:options.page,samples:String(samples)})}`));});
  group.command('schema').action(()=>output(z.toJSONSchema(sceneCommandSchema)));
  group.command('inspect <projectId>').option('--page <id>','Page ID').option('--time <seconds>','Sample pose time','0').action(async(projectId,options)=>{const time=z.coerce.number().finite().min(0).max(3600).parse(options.time);output(await client().json(`/api/projects/${encodeURIComponent(projectId)}/scene?${new URLSearchParams({time:String(time),...(options.page?{pageId:options.page}:{})})}`));});
  group.command('command <projectId>').requiredOption('--page <id>','Page ID').requiredOption('--revision <number>','Observed project revision').requiredOption('--file <path>','Command JSON or - for stdin').option('--apply','Save the command; default is read-only preview').action(async(projectId,options)=>{const body=sceneRequestSchema.parse({pageId:options.page,expectedRevision:Number(options.revision),command:await inputJson(options.file),preview:!options.apply});output(await client().json(`/api/projects/${encodeURIComponent(projectId)}/scene`,'POST',body));});
}

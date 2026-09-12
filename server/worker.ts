import {app} from './index';
import {processOperation} from './operation-worker';
import {processCommunityJob} from './community-jobs';
import {dispatchCommunityJob} from './community-jobs';
import {reconcileCommunityStorage} from './community-worker';
import type {Bindings} from './types';
export default {
  fetch:app.fetch,
  async queue(batch:{messages:{body:{id:string;kind?:'community'};ack():void;retry(options?:{delaySeconds:number}):void}[]},env:Bindings){
    for(const message of batch.messages)try{
      const complete=await(message.body.kind==='community'?processCommunityJob:processOperation)(env,message.body.id);
      if(complete)message.ack();else message.retry({delaySeconds:60});
    }catch{message.retry();}
  },
  async scheduled(_event:unknown,env:Bindings){
    await reconcileCommunityStorage(env);
    const jobs=await env.DB.prepare("SELECT id FROM community_jobs WHERE (status='queued' OR (status='running' AND lease_until<=?)) AND stage!='receiving' ORDER BY created_at LIMIT 25").bind(Date.now()).all<{id:string}>();
    for(const job of jobs.results)await dispatchCommunityJob(env,job.id);
  },
};

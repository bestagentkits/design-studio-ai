import {app} from './index';
import {processOperation} from './operation-worker';
import type {Bindings} from './types';
export default {fetch:app.fetch,async queue(batch:{messages:{body:{id:string};ack():void;retry(options?:{delaySeconds:number}):void}[]},env:Bindings){for(const message of batch.messages)try{const complete=await processOperation(env,message.body.id);if(complete)message.ack();else message.retry({delaySeconds:60});}catch{message.retry();}}};

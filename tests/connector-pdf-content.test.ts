import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {extractSourcePdf} from '../server/connectors/google-content';
test('PDF source extraction reads actual rendered text and rejects empty or oversized documents',async()=>{
  const browser=await chromium.launch();
  try{
    const page=await browser.newPage();await page.setContent('<h1>Selected source</h1><p>Private PDF text.</p>');
    const pdf=await page.pdf();const text=new TextDecoder().decode(await extractSourcePdf(new Uint8Array(pdf)));
    assert.match(text,/Selected source/);assert.match(text,/Private PDF text/);
    await page.setContent('<div style="width:40px;height:40px;background:red"></div>');
    const empty=await page.pdf();await assert.rejects(()=>extractSourcePdf(new Uint8Array(empty)),(error:any)=>error.code==='unsupported_content');
    await assert.rejects(()=>extractSourcePdf(new Uint8Array(2097153)),(error:any)=>error.code==='limit_exceeded');
  }finally{await browser.close();}
});

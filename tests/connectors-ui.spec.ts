import { test, expect } from './authenticated-browser';
import { randomUUID } from 'node:crypto';

test('external settings preserve pending setup and isolate it from agent credentials',async({page,baseURL})=>{
  const config=await (await page.request.get('/api/config')).json();
  test.skip(!config.connectorsEnabled,'Connector rollout is disabled; run with CONNECTORS_ENABLED=true.');
  const name=`MCP setup ${randomUUID().slice(0,8)}`;
  await page.goto('/?settings=connections');
  await expect(page.getByRole('heading',{name:'Your tools and source accounts'})).toBeVisible();
  await page.getByText('Add MCP server',{exact:true}).click();
  await page.getByLabel('Connection name',{exact:true}).fill(name);
  await page.getByLabel('MCP server URL',{exact:true}).fill('https://connector-test.example/mcp');
  await page.getByLabel('Authentication',{exact:true}).selectOption('bearer');
  await page.getByRole('button',{name:'Add server',exact:true}).click();
  await expect(page.getByRole('heading',{name:`Authorize ${name}`})).toBeVisible();
  await page.getByLabel('Bearer token',{exact:true}).fill('local-unused-form-value');
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await expect(page.getByLabel('Bearer token',{exact:true})).toHaveCount(0);
  const data=await (await page.request.get('/api/connections')).json();
  const created=data.connections.find((c:{displayName:string})=>c.displayName===name);
  expect(created.status).toBe('pending');expect(JSON.stringify(data)).not.toContain('local-unused-form-value');
  await page.reload();
  await page.getByRole('button',{name:'Your account and settings',exact:true}).click();
  await page.getByRole('button',{name:'External services',exact:true}).click();
  await expect(page.getByRole('heading',{name:name,exact:true})).toBeVisible();
  const article=page.locator('article').filter({has:page.getByRole('heading',{name:name,exact:true})});
  await article.getByRole('button',{name:'Disconnect',exact:true}).click();
  await expect(article.getByText('disconnected · mcp',{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  const denied=await page.request.post(`/api/connections/${created.id}/capabilities`,{headers:{Origin:baseURL!},data:{}});expect(denied.status()).toBe(409);
});

test('public MCP action survives refresh, requires approval and supports selection edits',async({page,baseURL})=>{
  test.skip(process.env.CONNECTOR_LIVE_MCP!=='true','Explicit public documentation MCP acceptance run only.');
  test.setTimeout(120000);
  const headers={Origin:baseURL!},name=`Cloudflare docs ${randomUUID().slice(0,8)}`;
  const created=await page.request.post('/api/projects',{headers,data:{name:'Connector acceptance',kind:'slides',templateId:'product-deck'}});
  expect(created.status()).toBe(201);const {project}=await created.json();let connectionId='';
  try{
    const response=await page.request.post('/api/connections',{headers,data:{displayName:name,config:{adapter:'mcp',endpoint:'https://docs.mcp.cloudflare.com/mcp',authMode:'anonymous'}}});
    expect(response.status()).toBe(201);const {connection}=await response.json();connectionId=connection.id;
    const connected=await page.request.post('/api/connectors/mcp/connect',{headers,data:{connectionId,expectedRevision:connection.revision}});expect(connected.status()).toBe(200);
    await page.goto(`/?project=${project.id}`);
    await page.getByRole('button',{name:'Tools & sources',exact:true}).click();
    await page.getByLabel('Add a connected server',{exact:true}).selectOption(connectionId);
    await page.getByRole('button',{name:'Discover available capabilities',exact:true}).click();
    await page.getByRole('checkbox',{name:/search_cloudflare_documentation/}).check();
    await page.getByRole('button',{name:'Enable selected capabilities',exact:true}).click();
    const article=page.locator('article').filter({has:page.getByRole('heading',{name,exact:true})});
    await article.getByText('Edit project selection',{exact:true}).click();
    const tools=article.getByLabel('Enabled tool names (one per line)',{exact:true});
    await tools.fill('search_cloudflare_documentation');await tools.press('End');await tools.press('Enter');await tools.pressSequentially('migrate_pages_to_workers_guide');
    await expect(tools).toHaveValue('search_cloudflare_documentation\nmigrate_pages_to_workers_guide');
    await article.getByRole('button',{name:'Save selection and revoke old grants',exact:true}).click();
    await expect(article.getByText('tool · policy revision 2',{exact:true})).toBeVisible();
    await article.getByRole('button',{name:'Inspect capabilities',exact:true}).click();
    await page.getByLabel('Tool',{exact:true}).selectOption('search_cloudflare_documentation');
    await page.getByLabel('Arguments (JSON)',{exact:true}).fill(JSON.stringify({query:'Workers global_fetch_strictly_public public Internet fetch'}));
    await page.getByRole('button',{name:'Prepare for review',exact:true}).click();
    await expect(page.getByRole('button',{name:'Allow once',exact:true})).toBeVisible();
    await page.reload();await page.getByRole('button',{name:'Tools & sources',exact:true}).click();
    await page.getByRole('button',{name:'Inspect action',exact:true}).click();
    await expect(page.getByRole('button',{name:'Allow once',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Allow once',exact:true}).click();
    await page.getByRole('button',{name:'Execute approved action',exact:true}).click();
    await expect(page.getByRole('status').filter({hasText:/^succeeded$/})).toBeVisible({timeout:35000});
    await expect(page.getByRole('heading',{name:'Remote result',exact:true})).toBeVisible();
    const list=await (await page.request.get(`/api/projects/${project.id}/connector-operations`)).json();expect(list.operations).toHaveLength(1);expect(list.operations[0].status).toBe('succeeded');
  }finally{
    if(connectionId){const all=await (await page.request.get('/api/connections')).json();const connection=all.connections.find((item:any)=>item.id===connectionId);if(connection)expect((await page.request.post(`/api/connections/${connectionId}/disconnect`,{headers,data:{expectedRevision:connection.revision}})).status()).toBe(200);}
    expect((await page.request.delete(`/api/projects/${project.id}`,{headers})).ok()).toBe(true);
  }
});

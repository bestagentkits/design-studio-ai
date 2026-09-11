import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {createDocument} from '../src/shared/catalog';
import {upgradeDocument} from '../src/shared/document-upgrade';
import {boardSchema} from '../src/shared/board-schema';
import {applyDiagramOperation} from '../src/shared/diagram-operations';
import {boardSvg} from '../src/shared/board-render';
import {fitDiagramBounds} from '../src/shared/diagram-curve';
import {writeFile} from 'node:fs/promises';

test('native diagram typography, hatching, inline editing, defaults and persistence',async({page,baseURL},info)=>{
  const headers={Origin:baseURL!};
  expect((await page.request.post('/api/auth/register',{headers,data:{email:`diagram-${randomUUID()}@studio.test`,password:randomUUID()+randomUUID(),name:'Diagram quality'}})).status()).toBe(201);
  const response=await page.request.post('/api/projects',{headers,data:{kind:'web',name:'Diagram quality'}});expect(response.status()).toBe(201);
  const {project}=await response.json();
  await page.goto(`/?project=${project.id}`);await page.getByRole('checkbox',{name:'Live',exact:true}).uncheck();
  await page.getByRole('button',{name:'Open creative board',exact:true}).click();
  await page.getByRole('button',{name:'diagram mode',exact:true}).click();
  await page.getByLabel('Diagram family',{exact:true}).selectOption('mind-map');
  await page.getByRole('button',{name:'Insert mind-map example',exact:true}).click();
  await page.getByRole('button',{name:'Fit diagram',exact:true}).click();
  const canvas=page.getByLabel('Drawing canvas',{exact:true});
  const root=canvas.locator('[data-board-element]').filter({has:page.locator('text').filter({hasText:'Main idea'})}).first();
  await root.dblclick();
  await page.getByLabel('Edit diagram label',{exact:true}).fill('Ý tưởng sáng tạo');
  await page.getByLabel('Edit diagram label',{exact:true}).press('Enter');
  await expect(canvas).toContainText('Ý tưởng sáng tạo');
  await page.getByLabel('Diagram style scope').selectOption('board');
  await page.getByLabel('Diagram fill style').selectOption('hachure');
  await page.getByLabel('Diagram font size').fill('28');
  await page.getByRole('button',{name:'Fit diagram',exact:true}).click();
  await expect(canvas.locator('text').filter({hasText:'Ý tưởng sáng tạo'})).toHaveAttribute('font-family','Patrick Hand');
  await expect(canvas.locator('[data-route-warning]')).toHaveCount(0);
  await page.getByLabel('Diagram font',{exact:true}).fill('Lora');
  await expect(canvas.locator('text').filter({hasText:'Ý tưởng sáng tạo'})).toHaveAttribute('font-family','Lora');
  await page.getByLabel('Diagram font',{exact:true}).fill('Patrick Hand');
  await page.getByText('Saved styles',{exact:true}).click();
  await page.getByLabel('Diagram preset name').fill('Vietnamese sketch');
  await page.getByRole('button',{name:'Save style preset',exact:true}).click();
  await expect(page.getByRole('button',{name:'Vietnamese sketch',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Fit diagram',exact:true}).click();
  const port=await canvas.locator('[data-diagram-port="right"]').boundingBox();
  const target=await canvas.locator('text').filter({hasText:'Research'}).boundingBox();
  expect(port).toBeTruthy();expect(target).toBeTruthy();
  await page.mouse.move(port!.x+port!.width/2,port!.y+port!.height/2);await page.mouse.down();
  await page.mouse.move(target!.x+target!.width/2,target!.y+target!.height/2,{steps:8});await page.mouse.up();
  await expect(canvas.locator('[data-board-element]')).toHaveCount(8);
  await page.getByRole('button',{name:'Undo board edit',exact:true}).click();
  await expect(canvas.locator('[data-board-element]')).toHaveCount(7);
  await page.getByRole('button',{name:'Redo board edit',exact:true}).click();
  await expect(canvas.locator('[data-board-element]')).toHaveCount(8);
  const newEdge=canvas.locator('[data-board-element]').last();
  const edgePoint=await newEdge.locator('path').first().evaluate((node:SVGPathElement)=>{const p=node.getPointAtLength(node.getTotalLength()/4);const screen=new DOMPoint(p.x,p.y).matrixTransform(node.getScreenCTM()!);return {x:screen.x,y:screen.y};});
  await page.mouse.click(edgePoint.x,edgePoint.y);
  const end=await canvas.locator('[data-connector-end="end"]').boundingBox();
  const delivery=canvas.locator('text').filter({hasText:'Delivery'}),destination=await delivery.boundingBox();
  const destinationId=await delivery.evaluate(n=>n.closest('[data-board-element]')!.getAttribute('data-board-element'));
  expect(end).toBeTruthy();expect(destination).toBeTruthy();
  await page.mouse.move(end!.x+end!.width/2,end!.y+end!.height/2);await page.mouse.down();
  await page.mouse.move(destination!.x+destination!.width/2,destination!.y+destination!.height/2,{steps:8});await page.mouse.up();
  await page.screenshot({path:info.outputPath('native-diagram-editor.png')});
  await page.getByRole('button',{name:'Close creative board',exact:true}).click();
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await expect.poll(async()=>{const d=(await(await page.request.get(`/api/projects/${project.id}`)).json()).project.document;return d.boards?.[0]?.diagramDefaults?.fillStyle;}).toBe('hachure');
  const saved=(await(await page.request.get(`/api/projects/${project.id}`)).json()).project.document;
  expect(saved.boards[0].elements.at(-1).end.binding.elementId).toBe(destinationId);
  await page.reload();await page.getByRole('button',{name:'Open creative board',exact:true}).click();
  await expect(page.getByLabel('Drawing canvas',{exact:true})).toContainText('Ý tưởng sáng tạo');
});

test('four native diagram families render with embedded Vietnamese fonts and portable SVG',async({page,browserName},info)=>{
  let doc=upgradeDocument(createDocument('slides'));doc.boards=[];
  for(const family of ['flowchart','architecture','user-flow','mind-map'] as const){
    doc.boards.push(boardSchema.parse({id:family,name:family,elements:[]}));
    doc=upgradeDocument(applyDiagramOperation(doc,{op:'diagram-template',boardId:family,family,prefix:family}));
    if(family==='mind-map') for(let i=0;i<3;i++)doc=upgradeDocument(applyDiagramOperation(doc,{op:'mind-map-insert',boardId:family,relativeId:'mind-map_n1',relation:'child',id:`detail${i}`,label:['Nét vẽ tự nhiên','Font tiếng Việt','Màu sắc tùy chỉnh'][i]}));
    if(family==='mind-map') doc=upgradeDocument(applyDiagramOperation(doc,{op:'diagram-layout',boardId:family,mode:'tree'}));
  }
  for(const board of doc.boards){
    const crop=fitDiagramBounds(board.elements),svg=boardSvg(board,doc,crop,1100,Math.round(1100*crop.height/crop.width));
    await writeFile(info.outputPath(`${board.id}.svg`),svg);
    await page.evaluate(async svg => {
      const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml');
      if (parsed.querySelector('parsererror')) throw new Error('Export is invalid SVG XML');
      const image = new Image(); image.src = 'data:image/svg+xml,' + encodeURIComponent(svg);
      await image.decode();
    }, svg);
    await page.setContent(`<style>body{margin:24px;background:#fff}svg{max-width:100%;height:auto}</style>${svg}`);
    await page.evaluate(()=>document.fonts.ready);
    expect(await page.evaluate(()=>document.fonts.check('24px "Patrick Hand"'))).toBe(true);
    await expect(page.locator('[data-route-warning]')).toHaveCount(0);
    await page.screenshot({path:info.outputPath(`${board.id}.png`),fullPage:true});
    if(browserName==='chromium') await page.pdf({path:info.outputPath(`${board.id}.pdf`),printBackground:true,width:'1200px',height:'1000px'});
  }
});

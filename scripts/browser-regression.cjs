const { chromium } = require('playwright');
const fs = require('fs');
const http = require('http');
const assert = require('node:assert/strict');
const path = require('node:path');
const repo = path.resolve(__dirname, '..');
const artifacts = path.join(repo, 'browser-results');
fs.mkdirSync(artifacts, { recursive: true });
let catalogRequests=0, promptKitRequests=0, archifyRequests=0, hostCapabilitiesRequests=0;
const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>科研工作台回归验证</title><div id="root"></div><div id="plugin-status"></div><div id="composer" data-composer-card style="position:fixed;bottom:12px;left:12px;width:min(560px,calc(100vw - 24px));z-index:30000"></div>
<script src="/react"></script><script src="/react-dom"></script>
<script>window.__ModuleLoader__={load({factory}){window.plugin=factory(id=>id==='react-dom'?ReactDOM:React)}};</script>
<script src="/bundle"></script><script>
const registered={}; window.toolViews={};
window.testEvents=[{type:'assistant/message',seq:14,time:123,data:{turn:2,message:{id:'review-one',content:[{type:'text',text:'研究表明，Ghd7 促进水稻耐盐性。见 https://doi.org/10.1038/review。'}]}}}];
window.testSessions={list:{getSnapshot(){return {current:'qa'}},subscribe(){return ()=>{}}},binding(){return {eventSource:{getSnapshot(){return {entries:window.testEvents}},subscribe(){return ()=>{}}}}}};
plugin.apply({sessions:window.testSessions,slots:{inject(n,fn){fn();return ()=>{}},register(o,c){if(o.name==='tool.call.toolview') window.toolViews[o.key]=c; else registered[o.id]=c;return ()=>{}}}});
const actions={setDraft(s){window.draft=s},submit(){}};
ReactDOM.createRoot(document.getElementById('composer')).render(React.createElement(React.Fragment,null,React.createElement(registered['dsh-research-kit-launcher']),React.createElement(registered['dsh-research-kit-overlay'],{sessionId:'qa',inputActions:actions}),React.createElement(registered['dsh-research-kit-draft-enhancer'],{sessionId:'qa',inputActions:actions})));
window.draft=''; window.root=ReactDOM.createRoot(document.getElementById('root'));
root.render(React.createElement(registered['dsh-research-kit-console'],{sessionId:'qa',inputActions:{setDraft(s){window.draft=s},submit(){}}}));
</script>`;
const server = http.createServer((req,res)=>{
 if(req.url==='/dsh-research-kit/catalog-data'){
  catalogRequests++;
  res.setHeader('Content-Type','application/json; charset=utf-8');
  return res.end(fs.readFileSync(path.join(repo,'ui/catalog-data.json')));
 }
 if(req.url==='/dsh-research-kit/archify-template'){
  archifyRequests++;
  res.setHeader('Content-Type','text/html; charset=utf-8');
  return res.end(fs.readFileSync(path.join(repo,'vendor/archify/template.html')));
 }
 if(req.url==='/dsh-research-kit/promptkit-client'){
  promptKitRequests++;
  res.setHeader('Content-Type','text/javascript; charset=utf-8');
  return res.end(fs.readFileSync(path.join(repo,'ui/promptkit.js')));
 }
 if(req.url==='/dsh-research-kit/host-capabilities'){
  hostCapabilitiesRequests++;
  res.setHeader('Content-Type','application/json; charset=utf-8');
  return res.end(JSON.stringify({ok:true,capabilities:{services:{web:true,shell:false,fs:false,llm:false},mcpServers:[],toolProbeAvailable:true,toolCount:0}}));
 }
 if(req.url?.startsWith('/dsh-research-kit/evidence-sync')){
  res.setHeader('Content-Type','application/json; charset=utf-8');
  if(req.method==='GET') return res.end(JSON.stringify({ok:true,entries:[]}));
  let body='';req.on('data',chunk=>{body+=chunk});req.on('end',()=>{
   const input=JSON.parse(body||'{}');
   res.end(JSON.stringify({ok:true,added:Array.isArray(input.entries)?input.entries.length:0,skipped:0,entry:input.entry||null}));
  });
  return;
 }
 const files={'/react':'node_modules/react/umd/react.development.js','/react-dom':'node_modules/react-dom/umd/react-dom.development.js','/bundle':'ui/client.js'};
 res.setHeader('Content-Type', files[req.url]?'text/javascript':'text/html');
 res.end(files[req.url]?fs.readFileSync(repo+'/'+files[req.url]):html);
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 let browser, page;
 try {
  browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL ? {channel:process.env.PLAYWRIGHT_CHANNEL} : {})});
  page=await browser.newPage({viewport:{width:1280,height:900}});
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error') errors.push(m.text())});
  page.setDefaultTimeout(10000);
  await page.goto('http://127.0.0.1:'+server.address().port);
  assert.equal(await page.title(),'科研工作台回归验证');
  await page.getByRole('tab',{name:'方法工坊',exact:true}).waitFor();
  await page.evaluate(()=>{
    const target=document.createElement('div'); target.id='tool-card-smoke'; document.body.append(target);
    const result={data:{entries:[{title:'证据样本',identifier:'10.1000/example',source_id:'crossref',stored_grade:'ungraded',suggested_grade:'empirical'}]}};
    window.toolCardRoot=ReactDOM.createRoot(target);
    window.toolCardRoot.render(React.createElement(window.toolViews['mcp__dsh-research-kit__research_evidence_list'],{toolName:'mcp__dsh-research-kit__research_evidence_list',phase:'result',block:{kind:'tool-result',content:[{type:'text',text:JSON.stringify(result)}]}}));
  });
  const toolCard=page.getByLabel('检索证据 工具详情');
  await toolCard.getByText('证据样本').waitFor();
  await toolCard.getByText(/DOI：10\.1000\/example · 已记录等级：未分级 · 建议等级：实证/).waitFor();
  await page.evaluate(()=>window.toolCardRoot.render(React.createElement(window.toolViews['mcp__dsh-research-kit__research_evidence_list'],{toolName:'mcp__dsh-research-kit__research_evidence_list',phase:'preparing',block:{phase:'preparing'},useToolCallArgumentsPartial:()=>'{"project":"测试项目"}'})));
  await toolCard.getByText('项目：测试项目').waitFor();
  await page.evaluate(()=>window.toolCardRoot.render(React.createElement(window.toolViews['mcp__dsh-research-kit__research_evidence_list'],{toolName:'mcp__dsh-research-kit__research_evidence_list',phase:'start',block:{phase:'start',argsRaw:'{"project":"测试项目"}'}})));
  await toolCard.getByText('执行中').waitFor();
  await page.evaluate(()=>window.toolCardRoot.render(React.createElement(window.toolViews['mcp__dsh-research-kit__research_evidence_list'],{toolName:'mcp__dsh-research-kit__research_evidence_list',phase:'result',block:{kind:'tool-result',isError:true,content:[{type:'text',text:'{"error":true,"message":"检索失败"}'}]}})));
  await toolCard.getByRole('alert').getByText('检索失败').waitFor();
  await page.evaluate(()=>{window.toolCardRoot.unmount();document.getElementById('tool-card-smoke').remove()});
  console.log('研究工具详情卡：完整 MCP 工具名与真实结果块渲染通过');
  await page.evaluate(()=>{
    window.testEvents=[];
    const target=document.createElement('div');target.id='message-action-smoke';target.style.cssText='position:fixed;top:720px;left:180px;z-index:10;height:30px;overflow:hidden';document.body.append(target);
    window.messageActionRoot=ReactDOM.createRoot(target);
    const nodes={values:()=>[{kind:'turn-tail',data:{closing:{turn:2,status:'settled',finalNode:{messageId:'review-one',seq:14,time:123},blocks:[{kind:'text',text:'研究表明，Ghd7 促进水稻耐盐性。见 https://doi.org/10.1038/review。'}]}}}]};
    window.messageActionRoot.render(React.createElement(registered['dsh-research-kit-review-deposit'],{messageId:'review-one',sessionId:'qa',useChat:select=>select({nodes})}));
  });
  await page.getByRole('button',{name:'审阅并沉淀这条研究回答'}).click();
  await page.getByRole('group',{name:'研究回答沉淀预览'}).getByText(/10\.1038\/review/).waitFor();
  const popover=await page.evaluate(()=>{
    const el=document.querySelector('[aria-label="研究回答沉淀预览"]'),r=el.getBoundingClientRect();
    return {portaled:el.parentElement===document.body,visible:r.top>=0&&r.bottom<=innerHeight,above:r.bottom<720,hit:el.contains(document.elementFromPoint(r.left+12,r.top+12))};
  });
  assert.deepEqual(popover,{portaled:true,visible:true,above:true,hit:true});
  if(process.env.RK_QA_SCREENSHOT) await page.screenshot({path:process.env.RK_QA_SCREENSHOT});
  await page.setViewportSize({width:390,height:900});
  await page.waitForFunction(()=>{
    const el=document.querySelector('[aria-label="研究回答沉淀预览"]');
    if(!el) return false;
    const r=el.getBoundingClientRect();
    return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;
  });
  if(process.env.RK_QA_MOBILE_SCREENSHOT) await page.screenshot({path:process.env.RK_QA_MOBILE_SCREENSHOT});
  await page.setViewportSize({width:1280,height:900});
  await page.getByRole('button',{name:'取消',exact:true}).click();
  await page.getByRole('button',{name:'审阅并沉淀这条研究回答'}).click();
  await page.getByRole('group',{name:'研究回答沉淀预览'}).getByLabel(/引用：10\.1038\/review/).uncheck();
  await page.getByRole('button',{name:'确认沉淀所选'}).click();
  await page.getByRole('status').getByText(/已沉淀：知识 .*证据 0/).waitFor();
  await page.evaluate(()=>window.messageActionRoot.render(React.createElement(registered['dsh-research-kit-review-deposit'],{messageId:'missing',sessionId:'qa',useChat:select=>select({nodes:{values:()=>[]}})})));
  await page.getByRole('button',{name:'审阅并沉淀这条研究回答'}).click();
  await page.getByRole('status').getByText('当前会话窗口中找不到这条回答。').waitFor();
  const noticePlacement=await page.evaluate(()=>{
    const el=[...document.querySelectorAll('[role="status"]')].find(item=>item.textContent.includes('当前会话窗口中找不到这条回答。')),r=el.getBoundingClientRect();
    return {portaled:el.parentElement===document.body,visible:r.top>=0&&r.bottom<=innerHeight,above:r.bottom<720,hit:el.contains(document.elementFromPoint(r.left+12,r.top+12))};
  });
  assert.deepEqual(noticePlacement,{portaled:true,visible:true,above:true,hit:true});
  if(process.env.RK_QA_NOTICE_SCREENSHOT) await page.screenshot({path:process.env.RK_QA_NOTICE_SCREENSHOT});
  await page.evaluate(()=>{window.messageActionRoot.unmount();document.getElementById('message-action-smoke').remove()});
  console.log('逐条回答：按消息 ID 预览、取消与勾选沉淀通过');
  await page.waitForTimeout(100);
  const capabilitiesBeforeStatusMount=hostCapabilitiesRequests;
  await page.evaluate(()=>ReactDOM.createRoot(document.getElementById('plugin-status')).render(React.createElement(registered['dsh-research-kit-status'],{subject:{kind:'bundle',pkg:{name:'dsh-research-kit'}}})));
  await page.getByLabel('Research Kit 运行状态').getByText('运行状态',{exact:true}).waitFor();
  await page.waitForTimeout(100);
  assert.equal(hostCapabilitiesRequests,capabilitiesBeforeStatusMount+1,'插件状态区每次挂载只能新增一次宿主能力探测');
  console.log('插件状态区单次探测宿主能力：通过');
  await page.getByRole('tab',{name:'方法工坊',exact:true}).click();
  await page.getByRole('heading',{name:'方法工坊',exact:true}).waitFor();
  await page.getByRole('tab',{name:'资源与工作流',exact:true}).click();
  console.log('PromptKit 延迟加载、方法工坊与输入框增强器挂载：通过');
  await page.getByRole('tab',{name:/工作流程/}).click();
  await page.getByRole('group',{name:'工作流程分类筛选'}).getByRole('button',{name:'生物信息学',exact:true}).click();
  assert.equal(await page.getByLabel('全部工作流程分类').inputValue(),'生物信息学');
  await page.getByLabel('全部工作流程分类').selectOption('all');
  assert.equal(await page.getByRole('group',{name:'工作流程分类筛选'}).getByRole('button',{name:'生物信息学',exact:true}).getAttribute('aria-pressed'),'false');
  await page.getByRole('tab',{name:/全部 \d/}).click();
  await page.getByLabel('资源列表').getByRole('button',{name:'收藏审阅论文',exact:true}).click();
  await page.getByRole('tab',{name:/★ 收藏/}).click();
  assert.ok(await page.getByLabel('资源列表').getByText('审阅论文',{exact:true}).count());
  await page.getByLabel('资源列表').getByText('审阅论文',{exact:true}).click();
  console.log('分类切回全部、收藏列表及打开详情：通过');
  await page.getByRole('button',{name:'组装回放',exact:true}).click();
  await page.waitForFunction(()=>{
    const nodes=document.querySelectorAll('.rk-replay-node');
    return nodes.length>0 && [...nodes].every(node=>node.classList.contains('lit'));
  });
  await page.getByRole('button',{name:'切到静态',exact:true}).click();
  assert.equal(await page.locator('.rk-replay-comet').count(),0);
  const popupPromise=page.waitForEvent('popup');
  await page.getByRole('button',{name:'弹出回放窗口',exact:true}).click();
  const popup=await popupPromise;
  await popup.waitForLoadState();
  const ids=await popup.locator('g[data-node-id]').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('data-node-id')));
  assert.ok(ids.length>0);
  assert.equal(new Set(ids).size,ids.length);
  await popup.close();
  assert.equal(catalogRequests,1,'科研目录应由所有视图共享一次请求');
  assert.equal(promptKitRequests,1,'PromptKit 应由所有消费入口共享一次请求');
  assert.equal(archifyRequests,1,'Archify 模板应只在回放窗口首次使用时请求一次');
  await page.getByRole('button',{name:'收起回放',exact:true}).click();
  console.log('回放自动完成、静态模式和独立窗口：通过');
  await page.getByLabel('提示词预览',{exact:true}).fill('手动编辑内容必须保留');
  await page.getByRole('button',{name:'组装回放',exact:true}).click();
  await page.getByText('提示词已手动编辑，自动组装轨迹可能与当前正文不一致。恢复自动生成后可查看组装回放。',{exact:true}).waitFor();
  assert.equal(await page.locator('.rk-replay-node').count(),0);
  await page.getByRole('button',{name:'收起回放',exact:true}).click();
  await page.getByLabel('选择科研模式领域预设').selectOption('bioinformatics');
  assert.equal(await page.getByLabel('提示词预览',{exact:true}).inputValue(),'手动编辑内容必须保留');
  console.log('切换科研模式保留手动编辑：通过');
  await page.getByRole('tab',{name:/数据库 \d/}).click();
  await page.getByLabel('资源列表').getByText('PubMed',{exact:true}).click();
  await page.getByLabel('英文检索式').fill('rice');
  await page.route('**/dsh-research-kit/query?**', route=>route.fulfill({json:{mode:'direct',query:'rice',sources:[{id:'test',title:'测试候选记录',url:'https://example.org/test'}]}}));
  await page.getByRole('button',{name:'查询',exact:true}).click();
  await page.getByText('测试候选记录',{exact:true}).waitFor();
  await page.getByRole('button',{name:'让 Agent 核验并继续查询',exact:true}).click();
  assert.match(await page.evaluate(()=>window.draft),/rice/);
  await page.getByLabel('资源列表').getByText('Crossref',{exact:true}).click();
  assert.equal(await page.getByText('测试候选记录',{exact:true}).count(),0);
  assert.equal(await page.getByLabel('英文检索式').inputValue(),'');
  console.log('英文查询传给 Agent、切换数据库清除旧结果：通过');
  for (const [type,quick] of [['技能','生物信息学'],['数据库','文献与引文']]) {
    await page.getByRole('tab',{name:new RegExp(type+' \\d')}).click();
    const group=page.getByRole('group',{name:type+'分类筛选'});
    await group.getByRole('button',{name:quick,exact:true}).click();
    assert.equal(await group.getByRole('combobox').inputValue(),quick);
    await group.getByRole('combobox').selectOption('all');
    assert.equal(await group.getByRole('button',{name:quick,exact:true}).getAttribute('aria-pressed'),'false');
  }
  await page.locator('#composer').getByRole('button',{name:'工作流程',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'选择科研工作流程'});
  await dialog.getByRole('button',{name:'生物信息学',exact:true}).click();
  assert.equal(await dialog.getByRole('combobox').inputValue(),'生物信息学');
  await dialog.getByRole('combobox').selectOption('all');
  await dialog.getByRole('combobox').selectOption('数据分析');
  assert.equal(await dialog.getByRole('combobox').inputValue(),'数据分析');
  await dialog.getByRole('button',{name:'关闭',exact:true}).click();
  console.log('技能、数据库及弹层共享分类栏：通过');
  await page.getByRole('tab',{name:'研究资产库',exact:true}).click();
  await page.getByRole('button',{name:'新建资产',exact:true}).click();
  await page.getByLabel('标题（留空自动取正文首行）').fill('水稻耐盐性研究');
  await page.getByLabel('内容',{exact:true}).fill('Ghd7 基因可能影响水稻耐盐性，需进一步验证。');
  await page.getByRole('button',{name:'保存资产',exact:true}).click();
  await page.getByRole('heading',{name:/^植物科学 · \d+$/}).waitFor();
  await page.getByLabel('搜索灵感资产').fill('主题:植物科学');
  await page.getByText('水稻耐盐性研究',{exact:true}).first().waitFor();
  await page.getByRole('button',{name:'按主题分组 ✓'}).click();
  assert.equal(await page.getByRole('heading',{name:/^植物科学 · \d+$/}).count(),0);
  await page.getByRole('button',{name:'按主题分组',exact:true}).click();
  await page.getByRole('heading',{name:/^植物科学 · \d+$/}).waitFor();
  await page.evaluate(async()=>{
    const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('dsh-research-kit-evidence');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});
    const tx=db.transaction('evidence','readwrite');
    const entries=[
      {id:'qa-agent-new',title:'待判断证据',url:'https://example.org/new',project:'',savedAt:Date.now(),status:'unverified'},
      {id:'qa-agent-human',title:'人工处理证据',url:'https://example.org/human',project:'',savedAt:Date.now()-1,status:'verified',assessedBy:'researcher',assessedAt:Date.now(),assessmentReason:'人工已核对'},
    ];
    for(const entry of entries) tx.objectStore('evidence').put(entry);
    await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)});
    db.close();
  });
  const assessedBatches=[];
  await page.route('**/dsh-research-kit/evidence-agent-assess?**',async route=>{
    const rows=route.request().postDataJSON().entries;
    assessedBatches.push(rows.map(row=>row.id));
    await route.fulfill({json:{ok:true,model:'qa-model',assessments:rows.map(row=>({id:row.id,traceability:'identified',studyType:'unknown',claimSupport:'unassessed',strength:'ungraded',confidence:'low',reason:'仅元数据初判，待核验原文。',model:'qa-model',at:Date.now()}))}});
  });
  await page.getByRole('tablist',{name:'沉淀层子模块'}).getByRole('tab',{name:'证据库',exact:true}).click();
  await page.getByLabel('包含人工处理过的').check();
  await page.getByRole('button',{name:'一键用 Agent 判断（2）'}).click();
  await page.getByText(/Agent 判断完成：/).waitFor();
  assert.deepEqual(assessedBatches,[['qa-agent-new','qa-agent-human']]);
  assert.equal(await page.getByText(/Agent 最新判断 · qa-model/).count(),2);
  await page.getByRole('button',{name:'一键用 Agent 判断（2）'}).click();
  await page.getByText(/Agent 判断完成：/).waitFor();
  assert.deepEqual(assessedBatches,[['qa-agent-new','qa-agent-human'],['qa-agent-new','qa-agent-human']]);
  assert.equal(await page.getByLabel('设置「人工处理证据」的人工评估依据').inputValue(),'人工已核对');
  if(process.env.RK_QA_AGENT_SCREENSHOT) await page.screenshot({path:process.env.RK_QA_AGENT_SCREENSHOT,fullPage:true});
  await page.getByRole('button',{name:'按主题分组 ✓'}).click();
  await page.getByRole('button',{name:'按主题分组',exact:true}).click();
  await page.getByRole('tablist',{name:'沉淀层子模块'}).getByRole('tab',{name:'灵感资产',exact:true}).click();
  console.log('旧资产动态主题标签、自动分组与列表切换：通过');
  await page.getByRole('button',{name:'迁移到 App'}).click();
  const transfer=page.getByText('迁移到 DSH App');
  await transfer.waitFor();
  const exportWait=page.waitForEvent('download');
  await page.getByRole('button',{name:'导出本端完整迁移包'}).click();
  const migration=await exportWait;
  const migrationText=fs.readFileSync(await migration.path(),'utf8');
  assert.equal(JSON.parse(migrationText).kind,'dsh-research-kit-app-transfer');
  await page.getByLabel('选择 Research Kit 迁移文件').setInputFiles({name:'research-transfer.json',mimeType:'application/json',buffer:Buffer.from(migrationText)});
  await page.getByText('导入预览（总数／预计新增／本端已有）').waitFor();
  const backupWait=page.waitForEvent('download');
  await page.getByRole('button',{name:'先下载本端备份'}).click();
  assert.match((await backupWait).suggestedFilename(),/^research-kit-before-import-/);
  await page.getByRole('button',{name:'确认增量导入'}).click();
  await page.getByText(/导入完成：新增证据 0 条/).waitFor();
  await page.getByRole('button',{name:'关闭',exact:true}).click();
  console.log('App 迁移包导出、校验预览、导入前备份与重复数据跳过：通过');
  const isolated=await browser.newContext();
  const appPage=await isolated.newPage();
  await appPage.goto('http://127.0.0.1:'+server.address().port);
  await appPage.getByRole('tab',{name:'方法工坊',exact:true}).waitFor();
  await appPage.waitForFunction(()=>!!window.__DSH_RESEARCH_PROMPTKIT__);
  await appPage.getByRole('button',{name:'迁移到 App'}).click();
  await appPage.getByLabel('选择 Research Kit 迁移文件').setInputFiles({name:'research-transfer.json',mimeType:'application/json',buffer:Buffer.from(migrationText)});
  await appPage.getByText('导入预览（总数／预计新增／本端已有）').waitFor();
  await appPage.getByText(/^灵感资产：\d+／\d+／0$/).waitFor();
  const isolatedBackupWait=appPage.waitForEvent('download');
  await appPage.getByRole('button',{name:'先下载本端备份'}).click();
  await isolatedBackupWait;
  await appPage.getByRole('button',{name:'确认增量导入'}).click();
  await appPage.getByText(/导入完成：/).waitFor();
  await appPage.getByRole('button',{name:'关闭',exact:true}).click();
  await appPage.getByRole('tab',{name:'研究资产库',exact:true}).click();
  await appPage.getByText('水稻耐盐性研究',{exact:true}).first().waitFor();
  await isolated.close();
  console.log('独立页面存储空间导入新增资产：通过');
  await page.screenshot({path:path.join(artifacts,'desktop.png'),fullPage:false});
  if(process.env.RK_QA_ASSET_DESKTOP_SCREENSHOT) await page.screenshot({path:process.env.RK_QA_ASSET_DESKTOP_SCREENSHOT});
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:path.join(artifacts,'mobile.png'),fullPage:false});
  if(process.env.RK_QA_ASSET_MOBILE_SCREENSHOT){
    await page.getByRole('heading',{name:/^植物科学 · \d+$/}).scrollIntoViewIfNeeded();
    await page.evaluate(()=>window.scrollBy(0,-180));
    await page.screenshot({path:process.env.RK_QA_ASSET_MOBILE_SCREENSHOT});
  }
  const sizes=await page.evaluate(()=>({viewport:innerWidth,content:document.documentElement.scrollWidth}));
  assert.ok(sizes.content<=sizes.viewport, JSON.stringify(sizes));
  console.log('390px 窄屏无页面横向溢出：通过');
  assert.deepEqual(errors,[]);
  console.log('浏览器运行错误：0');
 } catch(error) {
  if(page) await page.screenshot({path:path.join(artifacts,'failure.png'),fullPage:true}).catch(()=>{});
  throw error;
 } finally {await browser?.close();server.close()}
})().catch(e=>{console.error(e);server.close();process.exitCode=1});

const { chromium } = require('playwright');
const fs = require('fs');
const http = require('http');
const assert = require('node:assert/strict');
const path = require('node:path');
const repo = path.resolve(__dirname, '..');
const artifacts = path.join(repo, 'browser-results');
fs.mkdirSync(artifacts, { recursive: true });
let catalogRequests=0, promptKitRequests=0, archifyRequests=0, hostCapabilitiesRequests=0;
let claimRecords=[];
const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>科研工作台回归验证</title><div id="root"></div><div id="plugin-status"></div><div id="composer" data-composer-card style="position:fixed;bottom:12px;left:12px;width:min(560px,calc(100vw - 24px));z-index:30000"></div>
<script src="/react"></script><script src="/react-dom"></script>
<script>window.__ModuleLoader__={load({factory}){window.plugin=factory(id=>id==='react-dom'?ReactDOM:React)}};</script>
<script src="/bundle"></script><script>
const registered={}; window.toolViews={}; window.rowConfigs={};
window.testEvents=[{type:'assistant/message',seq:14,time:123,data:{turn:2,message:{id:'review-one',content:[{type:'text',text:'研究表明，Ghd7 促进水稻耐盐性。见 https://doi.org/10.1038/review。'}]}}}];
window.sessionEventsById={};
window.testSessions={list:{getSnapshot(){return {current:'qa'}},subscribe(){return ()=>{}}},binding(id){return {eventSource:{getSnapshot(){return {entries:window.sessionEventsById[id] || window.testEvents}},subscribe(){return ()=>{}}}}}};
// 假 slots 服务必须认三种注册形态：按 key（tool.call.toolview、plugins.row.config）、
// 按 id（徽章 / 动作 / 输入框）。过去只按 o.id 登记，键控注册一律落到 registered[undefined]——
// 于是 Plugins 行配置里的预设 UI 在浏览器回归里完全隐形（点不到，也就没人发现点击路径没被覆盖）。
const native = new URLSearchParams(location.search).has('native');
if (native) window.testSessions.binding = () => ({ctx:{}});
const conversation = {input:{for(){return {
 canInsertReferences:()=>true,addReferences(references){window.materialReference=references[0];return true}
}},requestDraftInitialization(){}}};
const uiWorkspace = {startSession(_workspace,payload){window.launchDraft=payload}};
plugin.apply({sessions:window.testSessions,get(name){return native ? {conversation,uiWorkspace}[name] : undefined},slots:{inject(n,fn){fn();return ()=>{}},register(o,c){if(o.name==='tool.call.toolview') window.toolViews[o.key]=c; else if(o.name==='plugins.row.config') window.rowConfigs[o.key]=c; else registered[o.id]=c;return ()=>{}}}});
const actions={setDraft(s){window.draft=s},submit(){}};
function ComposerHarness(){
 const [sessionId,setSessionId]=React.useState('qa');
 window.changeComposerSession=setSessionId;
 const [input,setInput]=React.useState(()=>({draft:'',draftRev:0,attachmentIds:[],occurrences:[],phase:'plain'}));
 window.setComposerDraft=(draft,attachmentIds=[],phase='plain')=>setInput(current=>({...current,draft,attachmentIds,phase,draftRev:current.draftRev+1}));
 window.composerInput=input;
 const props={sessionId,input,inputActions:{...actions,
   captureInsertion:()=>({start:input.draft.length,end:input.draft.length,draftRev:window.staleInsertion ? -1 : input.draftRev}),
   insertText(text,span){
     if(span.draftRev!==input.draftRev)return false;
     window.setComposerDraft(input.draft.slice(0,span.start)+text+input.draft.slice(span.end),input.attachmentIds);
     return true;
   }
 }};
 return React.createElement(React.Fragment,null,...['launcher','overlay','draft-enhancer'].map(id=>React.createElement(registered['dsh-research-kit-'+id],{key:id,...props})));
}
ReactDOM.createRoot(document.getElementById('composer')).render(React.createElement(ComposerHarness));
window.draft=''; window.root=ReactDOM.createRoot(document.getElementById('root'));
const consoleActions = {...actions,captureInsertion:()=>({start:0,end:0,draftRev:0}),insertText(text){window.draft=text;return true}};
root.render(React.createElement(registered['dsh-research-kit-console'],{sessionId:'qa',inputActions:consoleActions}));
if (native) ReactDOM.createRoot(document.getElementById('plugin-status')).render(React.createElement(registered['dsh-research-kit-project'],{sessionId:'qa'}));
</script>`;
const server = http.createServer((req,res)=>{
 if(req.url==='/dsh-research-kit/catalog-data'){
  catalogRequests++;
  res.setHeader('Content-Type','application/json; charset=utf-8');
  return res.end(fs.readFileSync(path.join(repo,'ui/catalog-data.json')));
 }
 if(req.url?.startsWith('/dsh-research-kit/catalog-item')){
  return import('../dsh/catalog-data.js').then(({ catalogItemRoute }) => catalogItemRoute().handler(req, res));
 }
 if(req.url?.startsWith('/dsh-research-kit/catalog-search')){
  return import('../dsh/catalog-data.js').then(({ catalogSearchRoute }) => catalogSearchRoute().handler(req, res));
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
 if(req.url?.startsWith('/dsh-research-kit/claim-review')){
  res.setHeader('Content-Type','application/json; charset=utf-8');
  if(req.method==='GET') return res.end(JSON.stringify({ok:true,project:'default',claims:[...claimRecords].reverse(),evidence:[{id:'qa-evidence-1',title:'人工核对的文献',identifier_type:'doi',identifier:'10.9999/qa'}]}));
  if(req.method==='POST'){
   let body='';req.on('data',chunk=>{body+=chunk});req.on('end',()=>{
    const input=JSON.parse(body||'{}');
    if(input.action==='import_local'){ for(const row of input.claims||[]) if(!claimRecords.some(item=>item.id===row.id)) claimRecords.push({...row,project:input.project,state:'extracted',evidence_ids:(row.links||[]).map(link=>link.evidenceId)}); return res.end(JSON.stringify({ok:true,added:0})); }
    if(input.action==='extract') return res.end(JSON.stringify({ok:true,drafts:[{statement:'候选 Claim 显示研究结果',state:'extracted',evidence_ids:['qa-evidence-1'],source_ref:{citation:'10.9999/qa',citation_type:'doi',locator:'char:18',excerpt:'候选 Claim 显示研究结果 [1](https://doi.org/10.9999/qa)。'},matched_evidence:true}]}));
    if(input.action==='save_drafts'){
     const claim={id:'qa-claim-2',project:'default',statement:'候选 Claim 显示研究结果',state:'extracted',evidence_ids:['qa-evidence-1'],source_ref:{citation:'10.9999/qa',citation_type:'doi',locator:'char:18'}};
     claimRecords.push(claim);
     return res.end(JSON.stringify({ok:true,saved:[claim],duplicates:[]}));
    }
    if(input.action==='export'){
     const blockers=claimRecords.filter(item=>item.state!=='verified').map(item=>({claim_id:item.id,state:item.state,reason:'未人工确认的 Claim 不得作为确定结论发布。'}));
     if(input.mode==='publication'&&blockers.length)return res.end(JSON.stringify({ok:true,ready:false,blockers}));
     return res.end(JSON.stringify({ok:true,ready:true,payload:{kind:'research-evidence',mode:input.mode,claims:claimRecords},blockers:[]}));
    }
    const previous=claimRecords.find(item=>item.id===input.claim_id);
    const claim={...previous,...input,id:input.claim_id||'qa-claim-1'};
    claimRecords=claimRecords.filter(item=>item.id!==claim.id).concat(claim);
    res.end(JSON.stringify({ok:true,claim,updated:Boolean(previous)}));
   });
  return;
 }
 }
 if(req.url?.startsWith('/dsh-research-kit/claim-agent-review')){
  res.setHeader('Content-Type','application/json; charset=utf-8');
  let body='';req.on('data',chunk=>{body+=chunk});req.on('end',()=>{
   const input=JSON.parse(body||'{}');
   for(const id of input.claim_ids||[]){const item=claimRecords.find(row=>row.id===id);if(item)item.agent_review={suggested_state:'ambiguous',confidence:'low',reason:'需核对全文和结果范围。',model:'qa-model'};}
   res.end(JSON.stringify({ok:true,reviewed:(input.claim_ids||[]).length,model:'qa-model'}));
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
  await page.getByRole('heading',{name:'本次研究',exact:true}).waitFor();
  assert.equal(await page.getByLabel('研究课题名称').count(),0);
  assert.equal(await page.getByRole('button',{name:/Agent 活动/}).count(),0);
  await page.screenshot({path:path.join(artifacts,'conversation-research-home.png')});
  assert.equal(promptKitRequests,0,'首页不得提前加载 PromptKit');
  await page.getByRole('button',{name:'证据关系',exact:true}).click();
  await page.getByRole('heading',{name:'研究证据图谱',exact:true}).waitFor();
  assert.equal(promptKitRequests,0,'独立图谱不得等待 PromptKit');
  await page.getByRole('tab',{name:'本次研究',exact:true}).click();
  await page.getByRole('button',{name:'验证研究结论',exact:true}).click();
  await page.getByLabel('新建 Claim 内容').waitFor();
  await page.getByRole('button',{name:'从最近回答开始',exact:true}).click();
  assert.ok((await page.getByLabel('待提取的研究段落').inputValue()).includes('Ghd7'));
  await page.screenshot({path:path.join(artifacts,'claim-onboarding.png'),fullPage:false});
  assert.equal(promptKitRequests,0,'独立 Claim 入口不得等待 PromptKit');
  await page.getByRole('button',{name:'研究资料',exact:true}).click();
  await page.getByRole('tab',{name:'灵感资产',exact:true}).click();
  await page.getByRole('tab',{name:'Claim 审阅',exact:true}).click();
  await page.getByLabel('新建 Claim 内容').fill('干预 A 改善结局 B');
  await page.getByRole('button',{name:'登记草稿'}).click();
  await page.getByText('干预 A 改善结局 B').waitFor();
  assert.equal(claimRecords[0].state,'extracted');
  await page.getByRole('button',{name:'逐条审阅'}).click();
  await page.getByRole('button',{name:'确认',exact:true}).click();
  await page.getByLabel('Claim 评估人').fill('测试研究者');
  await page.getByLabel('Claim 评估理由').fill('已核对研究方法和结果');
  await page.getByRole('button',{name:'保存审阅'}).click();
  await page.getByRole('status').getByText('确认 Claim 前至少关联一条已保存证据。').waitFor();
  assert.equal(claimRecords[0].state,'extracted');
  await page.getByLabel('关联证据：人工核对的文献').check();
  await page.getByRole('button',{name:'保存审阅'}).click();
  await page.getByText('已人工确认',{exact:true}).waitFor();
  assert.deepEqual(claimRecords[0].evidence_ids,['qa-evidence-1']);
  await page.getByLabel('待提取的研究段落').fill('候选 Claim 显示研究结果 [1](https://doi.org/10.9999/qa)。');
  await page.getByRole('button',{name:'提取候选'}).click();
  await page.getByRole('group',{name:'Claim 候选列表'}).getByText('候选 Claim 显示研究结果').waitFor();
  await page.getByLabel('登记候选 1').check();
  await page.getByRole('button',{name:'登记所选 1 条'}).click();
  await page.getByText('候选 Claim 显示研究结果',{exact:true}).waitFor();
  assert.equal(claimRecords[1].state,'extracted');
  await page.getByRole('button',{name:/Agent 审阅待核验 1 条/}).click();
  await page.getByText(/Agent 建议「存疑」/).waitFor();
  assert.equal(claimRecords[1].state,'extracted','Agent 不得改写人工状态');
  await page.getByRole('button',{name:'发布检查并导出'}).click();
  await page.getByRole('status').getByText(/发布检查未通过：1 条 Claim/).waitFor();
  await page.getByRole('button',{name:'逐条审阅'}).first().click();
  await page.getByRole('button',{name:'确认',exact:true}).click();
  await page.getByLabel('Claim 评估理由').fill('人工核对了来源方法和结果范围');
  await page.getByRole('button',{name:'保存审阅'}).click();
  await page.getByRole('button',{name:'发布检查并导出'}).click();
  await page.getByRole('status').getByText(/发布检查通过/).waitFor();
  assert.equal(claimRecords[1].state,'verified');
  if(process.env.RK_CLAIM_QA_SCREENSHOT) await page.screenshot({path:process.env.RK_CLAIM_QA_SCREENSHOT});
  await page.setViewportSize({width:390,height:900});
  const claimLayout=await page.getByLabel('Claim 审阅').evaluate(element=>({width:element.getBoundingClientRect().width,scrollWidth:element.scrollWidth}));
  assert.ok(claimLayout.scrollWidth<=claimLayout.width+2,'Claim 面板不应出现横向溢出');
  await page.getByText('干预 A 改善结局 B').scrollIntoViewIfNeeded();
  if(process.env.RK_CLAIM_QA_MOBILE_SCREENSHOT) await page.screenshot({path:process.env.RK_CLAIM_QA_MOBILE_SCREENSHOT});
  await page.setViewportSize({width:1280,height:900});
  console.log('Claim 审阅：草稿登记、确认门禁、证据关联及窄屏布局通过');
  await page.getByRole('tab',{name:'科研工具',exact:true}).click();
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
  const answerClaimRoute='**/dsh-research-kit/claim-review?project=default&offset=0';
  await page.route(answerClaimRoute, route=>route.fulfill({json:{ok:true,claims:[
    {id:'answer-claim',project:'default',statement:'Ghd7 促进水稻耐盐性',state:'verified',source_ref:{citation:'10.1038/review'},
      evidence_ids:['answer-evidence'],links:[{evidenceId:'answer-evidence',stance:'supports',locator:'结果段',assessedBy:'样板用户'}]},
    {id:'wrong-project',project:'另一课题',statement:'Ghd7 促进水稻耐盐性',state:'verified'},
  ],evidence:[{id:'answer-evidence',title:'已关联的测试来源',identifier_type:'doi',identifier:'10.1038/review'}]}}));
  await page.getByRole('button',{name:'审阅并沉淀这条研究回答'}).click();
  const answerPanel=page.getByRole('group',{name:'研究回答沉淀预览'});
  await answerPanel.getByRole('region',{name:'回答引用'}).getByRole('link',{name:'10.1038/review',exact:true}).waitFor();
  assert.equal(await answerPanel.getByRole('checkbox').count(),0,'查看引用时无需经过自动抽取候选');
  const popover=await page.evaluate(()=>{
    const el=document.querySelector('[aria-label="研究回答沉淀预览"]'),r=el.getBoundingClientRect();
    return {portaled:el.parentElement===document.body,visible:r.top>=0&&r.bottom<=innerHeight,above:r.bottom<720,hit:el.contains(document.elementFromPoint(r.left+12,r.top+12))};
  });
  assert.deepEqual(popover,{portaled:true,visible:true,above:true,hit:true});
  const linkClaim=page.getByRole('button',{name:'关联到此回答',exact:true});
  await linkClaim.waitFor();
  assert.equal(await linkClaim.count(),1);
  assert.equal(await page.getByRole('link',{name:'已关联的测试来源'}).count(),0);
  await linkClaim.click();
  const supportedClaim=page.getByRole('group',{name:'支持',exact:true});
  await supportedClaim.getByText(/原文位置 结果段/).waitFor();
  assert.equal(await supportedClaim.getByRole('link',{name:'已关联的测试来源'}).getAttribute('href'),'https://doi.org/10.1038/review');

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
  await supportedClaim.getByRole('link',{name:'已关联的测试来源'}).waitFor();
  await page.getByRole('button',{name:'取消关联',exact:true}).click();
  assert.equal(await supportedClaim.count(),0);
  await page.unroute(answerClaimRoute);
  await answerPanel.getByText('沉淀所选',{exact:true}).click();
  await answerPanel.getByLabel(/引用：10\.1038\/review/).uncheck();
  const nodeCandidate=answerPanel.getByRole('checkbox',{name:/^(?!引用：)/}).first();
  assert.equal(await nodeCandidate.isChecked(),false);
  await nodeCandidate.check();
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
  // Plugins 行配置（plugins.row.config，按 key 注册）里的预设在**真实 DOM** 上的点击路径：
  // 写入的 ops 与 revision、宿主拒绝时的「预设未保存」、只读禁用、未就绪不渲染。
  // 每次挂载都换一个全新容器：同一个 root 复用会保留组件状态（上一轮的「已应用」会污染下一轮）。
  await page.evaluate(()=>{
    window.presetCalls=[];
    window.mountPresets=form=>{
      if(window.rowConfigRoot){window.rowConfigRoot.unmount();window.rowConfigHost.remove();}
      const host=document.createElement('div');host.id='row-config-smoke';document.body.append(host);
      window.rowConfigHost=host;
      window.rowConfigRoot=ReactDOM.createRoot(host);
      window.rowConfigRoot.render(React.createElement(window.rowConfigs['dsh-research-kit#dsh-research-kit'],{view:'page',form}));
    };
    const Preset=window.rowConfigs['dsh-research-kit#dsh-research-kit'];
    if(typeof Preset!=='function') throw new Error('plugins.row.config 没有按 key 注册：'+JSON.stringify(Object.keys(window.rowConfigs)));
    window.mountPresets({state:{status:'ready',writable:true,revision:7},mutate:(ops,revision)=>{window.presetCalls.push({ops,revision});return Promise.resolve(true)}});
  });
  const presetSection=page.locator('#row-config-smoke');
  await presetSection.getByRole('button',{name:'应用',exact:true}).first().click();
  await presetSection.getByRole('button',{name:'已应用',exact:true}).waitFor();
  assert.deepEqual(await page.evaluate(()=>window.presetCalls),[{ops:[
    {op:'set',path:['memoryServer'],value:'memory-center'},
    {op:'set',path:['memoryTimeoutMs'],value:5000},
    {op:'set',path:['databaseTimeoutMs'],value:10000},
    {op:'set',path:['databaseRequestsPerMinute'],value:6},
    {op:'set',path:['allowAgentFallback'],value:false},
  ],revision:7}],'「直连研究」必须一次写入全部 5 个运行字段，并带上表单当前 revision');
  await presetSection.getByRole('button',{name:'应用',exact:true}).click();
  await page.waitForFunction(()=>window.presetCalls.length===2);
  const assistedCall=await page.evaluate(()=>window.presetCalls[1]);
  assert.deepEqual(assistedCall.ops,[
    {op:'set',path:['memoryServer'],value:'memory-center'},
    {op:'set',path:['memoryTimeoutMs'],value:15000},
    {op:'set',path:['databaseTimeoutMs'],value:15000},
    {op:'set',path:['databaseRequestsPerMinute'],value:12},
    {op:'set',path:['allowAgentFallback'],value:true},
  ]);
  assert.equal(assistedCall.revision,7);
  // 宿主拒绝写入（revision 冲突 / 校验失败）：必须显示「未保存」，不能悄悄显示「已应用」。
  await page.evaluate(()=>window.mountPresets({state:{status:'ready',writable:true,revision:8},mutate:(ops,revision)=>{window.presetCalls.push({ops,revision});return Promise.resolve(false)}}));
  await presetSection.getByRole('button',{name:'应用',exact:true}).first().click();
  await presetSection.getByText('预设未保存；请检查配置页的错误提示后重试。').waitFor();
  assert.equal((await page.evaluate(()=>window.presetCalls[2])).revision,8,'冲突写入也要沿用表单当前的 revision');
  // 只读（memory 模式等）与未就绪：禁用 / 整块不渲染，而不是留一个点了没反应的按钮。
  await page.evaluate(()=>window.mountPresets({state:{status:'ready',writable:false,revision:9},mutate:()=>Promise.resolve(true)}));
  assert.equal(await presetSection.getByRole('button',{name:'应用',exact:true}).first().isDisabled(),true);
  await page.evaluate(()=>window.mountPresets({state:{status:'loading'},mutate:()=>Promise.resolve(true)}));
  assert.equal(await presetSection.locator('section').count(),0,'表单未就绪时预设区必须整块不渲染');
  await page.evaluate(()=>{window.rowConfigRoot.unmount();window.rowConfigHost.remove()});
  console.log('Plugins 行配置预设：ops + revision 写入、拒绝提示与只读/未就绪降级通过');
  await page.getByRole('tab',{name:'用方法',exact:true}).click();
  await page.getByRole('heading',{name:'方法工坊',exact:true}).waitFor();
  await page.getByRole('tab',{name:'选流程',exact:true}).click();
  console.log('PromptKit 延迟加载、方法工坊与输入框增强器挂载：通过');
  await page.getByRole('tab',{name:/工作流程/}).click();
  await page.getByRole('group',{name:'工作流程分类筛选'}).getByRole('button',{name:'生物信息学',exact:true}).click();
  assert.equal(await page.getByLabel('全部工作流程分类').inputValue(),'生物信息学');
  await page.getByLabel('全部工作流程分类').selectOption('all');
  assert.equal(await page.getByRole('group',{name:'工作流程分类筛选'}).getByRole('button',{name:'生物信息学',exact:true}).getAttribute('aria-pressed'),'false');
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
  await popup.locator('g[data-node-id]').first().waitFor({state:'attached'});
  const ids=await popup.locator('g[data-node-id]').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('data-node-id')));
  assert.ok(ids.length>0);
  assert.equal(new Set(ids).size,ids.length);
  await popup.close();
  assert.equal(catalogRequests,1,'科研目录应由所有视图共享一次请求');
  assert.equal(promptKitRequests,1,'PromptKit 应由所有消费入口共享一次请求');
  const tracePage=await browser.newPage({viewport:{width:1280,height:900}});
  tracePage.on('pageerror',error=>errors.push(error.message));
  await tracePage.goto('http://127.0.0.1:'+server.address().port);
  await tracePage.evaluate(()=>{
    localStorage.setItem('dsh-research-kit.research-context.v1',JSON.stringify({project:'原文追溯验收',activeRunId:''}));
    const target=document.createElement('div');
    target.id='trace-answer';
    document.body.prepend(target);
    const text=[
      '中欧城市的卫星地表温差为 8–12 K。【依据：Schwaab 2021｜10.1038/s41467-021-26768-w｜结果；图 1；图 2c】',
      '麦迪逊 60–90 米尺度的估计差异更大。【依据：Ziter 2019｜10.1073/pnas.1817561116｜图 2C–D】',
      '【缺口：Ziter 的补充图 S4 未提供】',
    ].join('\n');
    window.testEvents.push({type:'assistant/message',seq:15,data:{message:{id:'trace-qa',content:[{type:'text',text}]}}});
    ReactDOM.createRoot(target).render(React.createElement(registered['dsh-research-kit-review-deposit'],{sessionId:'qa',messageId:'trace-qa'}));
  });
  await tracePage.locator('#trace-answer').getByRole('button',{name:'审阅并沉淀这条研究回答'}).click();
  const tracePreview=tracePage.getByRole('group',{name:'研究回答沉淀预览'});
  await tracePreview.getByRole('region',{name:'逐条核对结论'}).getByText(/证据缺口.*S4 未提供/).waitFor();
  assert.equal(await tracePreview.getByRole('link',{name:'Schwaab 2021'}).getAttribute('href'),'https://doi.org/10.1038/s41467-021-26768-w');
  assert.equal(await tracePreview.getByRole('link',{name:'Ziter 2019'}).getAttribute('href'),'https://doi.org/10.1073/pnas.1817561116');
  await tracePreview.getByText('沉淀所选',{exact:true}).click();
  await tracePreview.getByLabel(/引用：10\.1073\/pnas/).uncheck();
  await tracePreview.getByRole('checkbox',{name:/中欧城市的卫星地表温差/}).check();
  await tracePreview.getByRole('button',{name:'确认沉淀所选'}).click();
  await tracePage.getByRole('status').getByText(/知识 1、证据 1/).waitFor();
  await tracePage.reload();
  const persistedTrace=await tracePage.evaluate(async()=>{
    const database=await new Promise((resolve,reject)=>{
      const request=indexedDB.open('dsh-research-kit-knowledge');
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error);
    });
    try {
      return await new Promise((resolve,reject)=>{
        const request=database.transaction('nodes').objectStore('nodes').getAll();
        request.onsuccess=()=>resolve(request.result.filter(node=>node.project==='原文追溯验收'));
        request.onerror=()=>reject(request.error);
      });
    } finally { database.close(); }
  });
  assert.equal(persistedTrace.length,1);
  assert.equal(persistedTrace[0].evidenceIds.length,1);
  assert.match(persistedTrace[0].sources[0].excerpt,/Schwaab 2021 · 结果；图 1；图 2c/);
  await tracePage.getByRole('button',{name:'证据关系',exact:true}).click();
  await tracePage.getByRole('heading',{name:'研究证据图谱',exact:true}).waitFor();
  await tracePage.locator('svg a[aria-label^="聚焦 中欧城市的卫星地表温差"]').click();
  await tracePage.getByText(/原文位置（待核验）：Schwaab 2021 · 结果；图 1；图 2c/).waitFor();
  const originalDoi='https://doi.org/10.1038/s41467-021-26768-w';
  await tracePage.context().route(originalDoi,route=>route.fulfill({body:'论文目标地址已打开'}));
  const [originalPage]=await Promise.all([
    tracePage.waitForEvent('popup'),
    tracePage.locator(`a[href="${originalDoi}"]`).first().click(),
  ]);
  await originalPage.waitForURL(originalDoi);
  await originalPage.close();
  await tracePage.close();
  console.log('逐条原文追溯：隔离课题勾选、刷新后图谱定位与打开 DOI 通过');
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
  await page.getByRole('tab',{name:'查来源',exact:true}).click();
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
  await page.getByRole('tab',{name:'选流程',exact:true}).click();
  for (const [type,quick] of [['技能','生物信息学'],['数据库','文献与引文']]) {
    await (type==='数据库' ? page.getByRole('tab',{name:'查来源',exact:true}) : page.getByRole('tab',{name:/技能 \d/})).click();
    const group=page.getByRole('group',{name:type+'分类筛选'});
    await group.getByRole('button',{name:quick,exact:true}).click();
    assert.equal(await group.getByRole('combobox').inputValue(),quick);
    await group.getByRole('combobox').selectOption('all');
    assert.equal(await group.getByRole('button',{name:quick,exact:true}).getAttribute('aria-pressed'),'false');
  }
  await page.locator('#composer').getByRole('button',{name:'科研辅助',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'选择科研工作流程'});
  const category=dialog.getByRole('combobox',{name:'工作流程分类'});
  await category.selectOption('作物遗传育种');
  assert.equal(await category.inputValue(),'作物遗传育种');
  await page.emulateMedia({colorScheme:'dark'});
  await page.locator('#composer').evaluate(node=>{node.style.bottom='calc(100% - 200px)'});
  await page.setViewportSize({width:390,height:540});
  await dialog.locator('.rk-picker-row').first().waitFor();
  await dialog.locator('xpath=self::*[@data-short]').waitFor();
  assert.ok(await dialog.getByRole('switch',{name:'自动科研辅助'}).isVisible());
  const layout=await dialog.evaluate(node=>{
    const panel=node.getBoundingClientRect();
    const first=node.querySelector('.rk-picker-row').getBoundingClientRect();
    return {top:panel.top,height:panel.height,firstVisible:first.top>=panel.top && first.bottom<=panel.bottom,overflow:node.scrollHeight>node.clientHeight};
  });
  assert.ok(layout.top>=0 && layout.height<230 && layout.firstVisible && layout.overflow,JSON.stringify(layout));
  await dialog.screenshot({path:path.join(artifacts,'research-picker-compact-dark.png')});
  const last=dialog.locator('.rk-picker-row').last();
  await last.scrollIntoViewIfNeeded();
  assert.ok(await last.evaluate(row=>{
    const panel=row.closest('.rk-composer-picker').getBoundingClientRect();
    const box=row.getBoundingClientRect();
    return box.top>=panel.top && box.bottom<=panel.bottom;
  }));
  await dialog.getByRole('button',{name:'关闭',exact:true}).click();
  await page.locator('#composer').evaluate(node=>{node.style.bottom='12px'});
  await page.setViewportSize({width:1280,height:900});
  await page.emulateMedia({colorScheme:'light'});
  await page.locator('#composer').getByRole('button',{name:'科研辅助',exact:true}).click();
  await category.selectOption('数据分析');
  assert.equal(await category.inputValue(),'数据分析');
  await dialog.getByRole('button',{name:'关闭',exact:true}).click();
  await page.locator('#composer').getByRole('button',{name:'科研辅助',exact:true}).click();
  await dialog.getByRole('tab',{name:'加资源'}).click();
  const resources=page.getByRole('dialog',{name:'选择科研资源'});
  await resources.getByLabel('搜索',{exact:true}).fill('PubMed');
  await resources.getByRole('checkbox',{name:/PubMed/}).first().check();
  await resources.getByRole('combobox',{name:'资源类型'}).selectOption('selected');
  assert.equal(await resources.getByRole('checkbox',{name:/PubMed/}).first().isChecked(),true);
  await resources.getByRole('button',{name:/^完成 · /}).click();
  await page.locator('#composer').getByRole('button',{name:'科研辅助',exact:true}).click();
  const toggle=dialog.getByRole('switch',{name:'自动科研辅助'});
  assert.equal(await toggle.isChecked(),false);
  await page.evaluate(()=>{
    window.testEvents=[{type:'assistant/message',seq:100,data:{message:{id:'qa-old',content:[{type:'text',text:'研究表明，遮阴降低地表温度。见 10.1038/old。'}]}}}];
  });
  await toggle.check();
  await dialog.getByRole('button',{name:'关闭',exact:true}).click();
  await page.evaluate(()=>{
    window.testEvents.push(...[
      {type:'assistant/message',seq:101,data:{message:{id:'qa-research',content:[{type:'text',text:'研究表明，遮阴降低地表温度。见 10.1038/review。'}]}}},
      {type:'assistant/message',seq:102,data:{message:{id:'qa-ordinary',content:[{type:'text',text:'你好，今天聊得很愉快。'}]}}},
    ].map(event=>({type:'event',event})));
    const target=document.createElement('div');
    target.id='qa-auto-answer';
    document.body.prepend(target);
    window.autoAnswerRoot=ReactDOM.createRoot(target);
    window.autoAnswerRoot.render(React.createElement(React.Fragment,null,...['qa-old','qa-research','qa-ordinary'].map(messageId=>
      React.createElement(registered['dsh-research-kit-review-deposit'],{key:messageId,messageId,sessionId:'qa'}))));
  });
  const autoAnswer=page.locator('#qa-auto-answer');
  await autoAnswer.getByRole('button',{name:'可保存 1 条结论、1 条来源'}).waitFor();
  assert.equal(await autoAnswer.getByRole('button',{name:/可保存/}).count(),1);
  assert.equal(await autoAnswer.getByRole('button',{name:'审阅并沉淀这条研究回答'}).count(),2);
  await autoAnswer.getByRole('button',{name:'可保存 1 条结论、1 条来源'}).click();
  const autoPreview=page.getByRole('group',{name:'研究回答沉淀预览'});
  await autoPreview.getByRole('link',{name:'10.1038/review',exact:true}).waitFor();
  assert.equal(await autoPreview.getByRole('button',{name:'确认沉淀所选'}).count(),0);
  await autoPreview.getByRole('button',{name:'取消',exact:true}).click();
  await page.evaluate(()=>{window.autoAnswerRoot.unmount();document.getElementById('qa-auto-answer').remove()});

  const suggestion=page.getByRole('region',{name:'科研建议'});
  await page.evaluate(()=>{
    window.testEvents.push({type:'user/message',data:{content:[{type:'text',text:'请做一个关于水稻产量的文献综述。'}]}});
    window.setComposerDraft('请继续刚才的研究。');
  });
  await suggestion.getByText('当前提问在延续本会话最近一次明确的研究任务。').waitFor();
  await suggestion.getByRole('button',{name:'略过'}).click();
  await page.evaluate(()=>window.setComposerDraft('什么是文献综述？'));
  await page.waitForTimeout(850);
  assert.equal(await suggestion.count(),0);
  const original='请比较这两篇论文的证据强度。';
  await page.evaluate(text=>window.setComposerDraft(text,['file1','file2']),original);
  await suggestion.getByText('论文对比分析').waitFor();
  await page.screenshot({path:path.join(artifacts,'conversation-research-suggestion.png')});
  await suggestion.getByRole('button',{name:'预览改动'}).click();
  const preview=page.getByRole('dialog',{name:'预览科研建议'});
  const shortPrompt=await preview.getByLabel('将插入的科研步骤').inputValue();
  assert.match(shortPrompt,/科研执行步骤.*先回答差异/s);
  assert.match(shortPrompt,/区分实测、模型估计和推测.*勿把局部阈值推广为通用门槛/);
  assert.match(shortPrompt,/【缺口：具体缺失】/);
  assert.match(shortPrompt,/DOI｜原文章节或图表/);
  assert.doesNotMatch(shortPrompt,/@文件|附加技能指导/);
  await page.evaluate(()=>{window.staleInsertion=true});
  await preview.getByRole('button',{name:'采用并插入'}).click();
  await preview.getByText('草稿暂时无法写入，请检查当前输入后重试。').waitFor();
  assert.equal(await page.evaluate(()=>window.composerInput.draft),original);
  await page.evaluate(()=>{window.staleInsertion=false});
  await preview.getByRole('button',{name:'采用并插入'}).click();
  const adopted=await page.evaluate(()=>window.composerInput);
  assert.ok(adopted.draft.startsWith(original));
  assert.match(adopted.draft,/科研执行步骤/);
  assert.deepEqual(adopted.attachmentIds,['file1','file2']);
  await page.evaluate(()=>window.setComposerDraft('请做一个关于水稻耐盐性的文献综述。'));
  await suggestion.getByRole('button',{name:'略过'}).click();
  await page.evaluate(()=>window.setComposerDraft('请做一个关于水稻耐盐性的文献综述。'));
  await page.waitForTimeout(850);
  assert.equal(await suggestion.count(),0);
  await page.locator('#composer').getByRole('button',{name:'科研辅助',exact:true}).click();
  await dialog.getByRole('button',{name:'整理当前提问'}).click();
  await page.getByRole('button',{name:'应用增强到消息框'}).waitFor();
  await page.keyboard.press('Escape');

  const firstPrompt='请核对遮阴对地表温度的影响。';
  await page.evaluate(()=>{
    window.sessionEventsById['qa-blank']=[];
    window.changeComposerSession('qa-blank');
  });
  const workflowLauncher=page.locator('#composer').getByRole('button',{name:'科研辅助',exact:true});
  await workflowLauncher.click();
  await toggle.check();
  await dialog.getByRole('button',{name:'关闭',exact:true}).click();
  await page.evaluate(draft=>window.setComposerDraft(draft,[],'sending'),firstPrompt);
  await page.locator('#composer').evaluate(node=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await page.evaluate(draft=>{
    window.sessionEventsById['qa-created']=[
      {type:'turn/start',seq:1,data:{turn:1}},
      {type:'user/message',seq:2,data:{source:{kind:'user'},content:[{type:'text',text:draft}]}},
    ].map(event=>({type:'event',event}));
    window.setComposerDraft('');
    window.changeComposerSession('qa-created');
  },firstPrompt);
  await workflowLauncher.click();
  await toggle.waitFor();
  assert.equal(await toggle.isChecked(),true,'首条消息落到新的正式会话后应保留科研辅助开关');
  await dialog.getByRole('button',{name:'关闭',exact:true}).click();
  await page.evaluate(()=>window.changeComposerSession('qa'));
  console.log('统一入口、资源选择、手动整理及自动建议确认与过期保护：通过');
  await page.getByRole('tab',{name:'我的',exact:true}).click();
  await page.getByRole('button',{name:'从目录复制'}).click();
  await page.getByLabel('搜索可复制的模板').fill('审阅论文');
  await page.getByRole('button',{name:'复制流程 · 审阅论文',exact:true}).click();
  assert.match(await page.getByLabel('模板内容').inputValue(),/通用科研边界/);
  await page.getByRole('button',{name:'取消',exact:true}).click();
  await page.getByRole('button',{name:'新建流程'}).click();
  await page.getByLabel('模板名称').fill('个人科研模板');
  await page.getByLabel('模板内容').fill('先核验来源，再整理研究步骤。');
  await page.getByRole('button',{name:'保存模板'}).click();
  await page.getByRole('button',{name:'查看或编辑'}).click();
  assert.match(await page.getByLabel('模板内容').inputValue(),/核验来源/);
  await page.getByLabel('模板内容').fill('先核验来源，再列出证据缺口。');
  await page.getByRole('button',{name:'保存模板'}).click();
  await page.getByRole('button',{name:'插入草稿'}).click();
  assert.match(await page.evaluate(()=>window.draft),/证据缺口/);
  await page.getByRole('button',{name:'版本记录'}).click();
  await page.getByRole('button',{name:/^查看 .*个人科研模板/}).click();
  assert.match(await page.getByLabel('模板内容').inputValue(),/整理研究步骤/);
  await page.getByRole('button',{name:'取消',exact:true}).click();
  await page.getByRole('button',{name:'查看或编辑'}).click();
  await page.getByRole('button',{name:'从目录复制'}).click();
  await page.getByLabel('搜索可复制的模板').fill('禁止静默丢弃数据');
  const copyCleanWorkflow=page.getByRole('button',{name:'复制流程 · 数据清洗方案',exact:true});
  await copyCleanWorkflow.waitFor();
  let releaseDelayedCopy, delayedCopyStarted;
  const delayedCopyReady=new Promise(resolve=>{releaseDelayedCopy=resolve});
  const delayedCopyRequested=new Promise(resolve=>{delayedCopyStarted=resolve});
  const delayedCopyRoute='**/dsh-research-kit/catalog-item?*';
  await page.route(delayedCopyRoute,async route=>{
    delayedCopyStarted();
    await delayedCopyReady;
    await route.continue();
  });
  await copyCleanWorkflow.click();
  await delayedCopyRequested;
  await page.getByLabel('模板内容').fill('等待复制期间手写保留的内容');
  const delayedCopyResponse=page.waitForResponse(response=>response.url().includes('/dsh-research-kit/catalog-item?'));
  releaseDelayedCopy();
  await delayedCopyResponse;
  await page.waitForTimeout(50);
  assert.equal(await page.getByLabel('模板内容').inputValue(),'等待复制期间手写保留的内容','复制等待期间编辑已有模板，迟到响应不得覆盖草稿');
  await page.unroute(delayedCopyRoute);
  await page.getByRole('button',{name:'取消',exact:true}).click();
  await page.getByRole('button',{name:'从目录复制'}).click();
  console.log('个人流程新建、编辑、复用、正文复制搜索、延迟复制保稿与历史版本：通过');
  await page.getByRole('tab',{name:'本次研究',exact:true}).click();
  await page.getByRole('button',{name:'研究资料',exact:true}).click();
  await page.getByRole('tab',{name:'灵感资产',exact:true}).click();
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
    const savedAt=Date.now();
    const entries=[
      {id:'qa-agent-new',title:'待判断证据',url:'https://example.org/new',project:'',savedAt,status:'unverified'},
      {id:'qa-agent-human',title:'人工处理证据',url:'https://example.org/human',project:'',savedAt:savedAt-1,status:'verified',assessedBy:'researcher',assessedAt:Date.now(),assessmentReason:'人工已核对'},
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
  await page.getByRole('button',{name:'用 Agent 判断完整范围（2）'}).click();
  await page.getByText(/Agent 判断完成：/).waitFor();
  assert.deepEqual(assessedBatches,[['qa-agent-new','qa-agent-human']]);
  await page.waitForFunction(()=>Array.from(document.querySelectorAll('*')).filter(node=>node.children.length===0&&/Agent 最新判断 · qa-model/.test(node.textContent)).length===2);
  assert.equal(await page.getByText(/Agent 最新判断 · qa-model/).count(),2);
  const secondAssessment = page.waitForResponse(response => response.url().includes('/evidence-agent-assess?'));
  await page.getByRole('button',{name:'用 Agent 判断完整范围（2）'}).click();
  await secondAssessment;
  await page.getByRole('button',{name:'用 Agent 判断完整范围（2）'}).waitFor();
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
  await appPage.getByRole('button',{name:'研究资料',exact:true}).click();
  await appPage.getByRole('button',{name:'迁移到 App'}).click();
  await appPage.waitForFunction(()=>!!window.__DSH_RESEARCH_PROMPTKIT__);
  await appPage.getByLabel('选择 Research Kit 迁移文件').setInputFiles({name:'research-transfer.json',mimeType:'application/json',buffer:Buffer.from(migrationText)});
  await appPage.getByText('导入预览（总数／预计新增／本端已有）').waitFor();
  await appPage.getByText(/^灵感资产：\d+／\d+／0$/).waitFor();
  const isolatedBackupWait=appPage.waitForEvent('download');
  await appPage.getByRole('button',{name:'先下载本端备份'}).click();
  await isolatedBackupWait;
  await appPage.getByRole('button',{name:'确认增量导入'}).click();
  await appPage.getByText(/导入完成：/).waitFor();
  await appPage.getByRole('button',{name:'关闭',exact:true}).click();
  await appPage.getByRole('button',{name:'研究资料',exact:true}).click();
  await appPage.getByText('水稻耐盐性研究',{exact:true}).first().waitFor();
  await isolated.close();
  console.log('独立页面存储空间导入新增资产：通过');
  const largeContext=await browser.newContext();
  const largePage=await largeContext.newPage();
  largePage.on('pageerror',error=>errors.push(String(error)));
  await largePage.goto('http://127.0.0.1:'+server.address().port);
  await largePage.getByRole('heading',{name:'本次研究',exact:true}).waitFor();
  await largePage.getByRole('button',{name:'研究资料',exact:true}).click();
  await largePage.getByRole('tablist',{name:'沉淀层子模块'}).getByRole('tab',{name:'证据库',exact:true}).click();
  await largePage.getByText('第 1 页 · 本页 0 条 · 完整范围 0 条',{exact:true}).waitFor();
  await largePage.evaluate(async()=>{
    const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('dsh-research-kit-evidence');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});
    const tx=db.transaction('evidence','readwrite');
    for(let index=0;index<10000;index++) tx.objectStore('evidence').put({id:'large-'+String(index).padStart(5,'0'),title:'性能证据 '+String(index).padStart(5,'0'),url:'https://example.org/large/'+index,project:'',savedAt:100,status:'unverified'});
    await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)});db.close();
  });
  const pageStarted=Date.now();
  await largePage.getByRole('button',{name:'重试同步',exact:true}).click();
  await largePage.getByText('第 1 页 · 本页 50 条 · 完整范围 10000 条',{exact:true}).waitFor();
  assert.equal(await largePage.getByRole('checkbox',{name:/用于 Agent 判断或写入 Prompt/}).count(),50);
  console.log('真实 IndexedDB 1 万条首个分页可见耗时（含摘要读取）：'+(Date.now()-pageStarted)+'ms');
  await largePage.getByRole('checkbox',{name:/用于 Agent 判断或写入 Prompt/}).first().check();
  await largePage.getByRole('button',{name:'下一页',exact:true}).click();
  await largePage.getByText('第 2 页 · 本页 50 条 · 完整范围 10000 条',{exact:true}).waitFor();
  await largePage.getByRole('checkbox',{name:'选择「性能证据 09949」用于 Agent 判断或写入 Prompt',exact:true}).waitFor();
  await largePage.getByRole('checkbox',{name:/用于 Agent 判断或写入 Prompt/}).first().check();
  await largePage.getByRole('button',{name:'写入 Prompt（2）',exact:true}).waitFor();
  await largePage.screenshot({path:path.join(artifacts,'cross-page-selection.png'),fullPage:false});
  await largePage.getByRole('button',{name:'写入 Prompt（2）',exact:true}).click();
  assert.ok((await largePage.evaluate(()=>window.draft)).includes('性能证据 09999'));
  assert.ok((await largePage.evaluate(()=>window.draft)).includes('性能证据 09949'));
  await largePage.getByRole('button',{name:'上一页',exact:true}).click();
  await largePage.getByText('第 1 页 · 本页 50 条 · 完整范围 10000 条',{exact:true}).waitFor();
  await largePage.screenshot({path:path.join(artifacts,'evidence-pagination.png'),fullPage:false});
  await largePage.getByLabel('搜索证据条目').fill('性能证据 00001');
  await largePage.getByText('第 1 页 · 本页 1 条 · 完整范围 10000 条',{exact:true}).waitFor();
  assert.equal(await largePage.getByRole('checkbox',{name:/用于 Agent 判断或写入 Prompt/}).count(),1);
  await largePage.getByRole('button',{name:'写入 Prompt（2）',exact:true}).waitFor();
  await largePage.getByRole('button',{name:'导入文献引用',exact:true}).click();
  await largePage.getByLabel('BibTeX 或 RIS 引用内容').fill('@article{qa,title={浏览器引用往返},author={Li and Wang},year={2024},doi={10.9999/browser}}');
  await largePage.getByRole('button',{name:'预览引用',exact:true}).click();
  await largePage.getByRole('button',{name:'确认保存所选 0 条（待核验）',exact:true}).waitFor();
  const beforeImport=await largePage.evaluate(async()=>{const db=await new Promise(resolve=>{const request=indexedDB.open('dsh-research-kit-evidence');request.onsuccess=()=>resolve(request.result)});return new Promise(resolve=>{const request=db.transaction('evidence').objectStore('evidence').count();request.onsuccess=()=>{db.close();resolve(request.result)}})});
  assert.equal(beforeImport,10000);
  await largePage.getByRole('button',{name:'选择全部预览引用',exact:true}).click();
  await largePage.getByRole('button',{name:'确认保存所选 1 条（待核验）',exact:true}).click();
  await largePage.getByLabel('搜索证据条目').fill('浏览器引用往返');
  await largePage.getByText('第 1 页 · 本页 1 条 · 完整范围 10001 条',{exact:true}).waitFor();
  const imported=await largePage.evaluate(async()=>{const db=await new Promise(resolve=>{const request=indexedDB.open('dsh-research-kit-evidence');request.onsuccess=()=>resolve(request.result)});return new Promise(resolve=>{const request=db.transaction('evidence').objectStore('evidence').getAll();request.onsuccess=()=>{db.close();resolve(request.result.find(row=>row.title==='浏览器引用往返'))}})});
  assert.equal(imported.status,'unverified');assert.deepEqual(imported.bibliography.authors,['Li','Wang']);
  await largePage.setViewportSize({width:390,height:844});
  assert.ok(await largePage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await largeContext.close();
  console.log('真实 IndexedDB 1 万条分页、跨页及跨筛选选择、全范围搜索、显式引用导入与窄屏布局：通过');

  const runContext = await browser.newContext();
  const runPage = await runContext.newPage();
  runPage.on('pageerror', error => errors.push(String(error)));
  await runContext.addInitScript(() => {
    localStorage.setItem('dsh-research-kit.research-context.v1', JSON.stringify({ project: '综述样板', activeRunId: '' }));
    localStorage.setItem('dsh-research-kit.research-runs.v1', JSON.stringify([
      { id: 'run-review-original', project: '综述样板', sessionId: 'older-session', workflowId: 'literature-review', workflowName: '综述原运行', status: 'draft', createdAt: 123 },
      { id: 'run-review-current', project: '综述样板', sessionId: 'qa', workflowId: 'literature-review', workflowName: '当前会话运行', status: 'draft', createdAt: 456 },
    ]));
  });
  let stageApproved=false;
  await runPage.route('**/dsh-research-kit/agent-activity*', route => {
    if (route.request().method()==='POST') {
      assert.deepEqual(route.request().postDataJSON(),{action:'research_run_checkpoint_approve',run_id:'run-review-original',stage:'screen'});
      stageApproved=true;
      return route.fulfill({json:{ok:true}});
    }
    const id=new URL(route.request().url()).searchParams.get('run_id');
    return route.fulfill({ json: {
      ok:true, calls:[],
      checkpoints:[{run_id:id,checkpoints:{screen:{approved:stageApproved}}}],
      artifacts:[{id:'qa-artifact', summary:'上次综述产出'}],
      run_overview:{run_id:id,project:id==='run-other'?'另一课题':'综述样板',passport_found:true},
    } });
  });
  await runPage.route('**/dsh-research-kit/claim-review?**', route => route.fulfill({ json: {
    ok:true, evidence:[{ id:'paper-2', title:'反向样板来源', url:'https://example.org/refutes' }], claims:[{
      id:'review-claim', project:'综述样板', run_id:'run-review-original', statement:'需要核对的综述结论',
      state:'ambiguous', assessed_by:'样板审核者', assessment_reason:'待核对原文范围', evidence_ids:['paper-1','paper-2','paper-missing'],
      links:[{evidenceId:'paper-1', stance:'supports', locator:'结果段'},
        {evidenceId:'paper-2', stance:'refutes', locator:'讨论段'}],
    },{
      id:'review-unlinked', project:'综述样板', state:'extracted', statement:'没有证据的样板结论', evidence_ids:[],
    }],
  } }));
  await runPage.route('**/dsh-research-kit/evidence-sync?**', route => route.fulfill({
    json:{ok:false,error:'样板重复来源'}, status:409,
  }));
  await runPage.goto('http://127.0.0.1:'+server.address().port+'/?native=1');
  await runPage.getByRole('heading',{name:'本次研究',exact:true}).waitFor();
  await runPage.locator('#plugin-status').getByText('当前会话运行',{exact:true}).waitFor();
  const projectButton=runPage.getByRole('button',{name:'课题 · 综述样板',exact:true});
  await projectButton.click();
  await runPage.getByLabel('研究课题名称').fill('其他课题');
  await runPage.getByRole('button',{name:'切换课题',exact:true}).click();
  await runPage.getByRole('button',{name:'课题 · 其他课题',exact:true}).click();
  await runPage.getByLabel('研究课题名称').fill('综述样板');
  await runPage.getByRole('button',{name:'切换课题',exact:true}).click();
  await projectButton.click();
  await runPage.getByText('载入已有研究运行',{exact:true}).click();
  await runPage.getByLabel('研究运行 ID').fill('run-other');
  await runPage.getByRole('button',{name:'载入运行',exact:true}).click();
  await runPage.getByText(/当前课题中找不到该运行/).waitFor();
  await runPage.getByLabel('研究运行 ID').fill('run-mcp-existing');
  await runPage.getByRole('button',{name:'载入运行',exact:true}).click();
  await runPage.getByText('当前运行：run-mcp-existing',{exact:true}).waitFor();
  await runPage.getByLabel('恢复指定运行').selectOption('run-review-original');
  await runPage.getByText('上次综述产出',{exact:true}).waitFor();
  await runPage.getByText(/待核验 Claim 1/).waitFor();
  const approve=runPage.getByRole('button',{name:'确认阶段 screen',exact:true});
  await approve.click();
  await approve.waitFor({state:'hidden'});
  assert.ok(stageApproved);
  console.log('按需切换课题、载入同课题运行及收件箱阶段确认：通过');
  await runPage.getByRole('button',{name:'写入继续研究草稿'}).click();
  assert.match(await runPage.evaluate(()=>window.draft), /run-review-original/);
  await runPage.getByLabel('工作区文件路径').fill('文献/第 一篇.pdf');
  await runPage.getByRole('button',{name:'添加材料引用'}).click();
  assert.equal(await runPage.evaluate(()=>window.materialReference.ref), '@"文献/第 一篇.pdf"');
  await runPage.getByRole('button',{name:'打开证据与筛选队列'}).click();
  await runPage.getByRole('button',{name:'导出当前项目综述与审核记录'}).waitFor();
  await runPage.evaluate(async()=>{
    const db=await new Promise((resolve,reject)=>{const req=indexedDB.open('dsh-research-kit-evidence');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)});
    const tx=db.transaction(['evidence','researchLedger'],'readwrite');
    tx.objectStore('evidence').put({id:'paper-1',title:'样板来源',project:'综述样板',savedAt:1,status:'unverified',identifierKind:'doi',identifier:'10.9999/qa'});
    tx.objectStore('researchLedger').put({id:'screen-1',kind:'screening',project:'综述样板',evidenceId:'paper-1',decision:'include',at:1});
    await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)});db.close();
  });
  const reviewDownload = runPage.waitForEvent('download');
  await runPage.getByRole('button',{name:'导出当前项目综述与审核记录'}).click();
  const report = JSON.parse(fs.readFileSync(await (await reviewDownload).path(), 'utf8'));
  assert.equal(report.summary.included, 1);
  assert.equal(report.claims[0].reason, '待核对原文范围');
  assert.equal(report.claims[0].links[0].sourceAvailable, true);
  assert.equal(report.claims[0].links[0].stance, 'supports');
  await runPage.getByRole('tab',{name:'Claim 审阅',exact:true}).click();
  await runPage.getByText('需要核对的综述结论',{exact:true}).waitFor();
  await runPage.getByText(/文件同步失败.*HTTP 409/).waitFor();
  const targetClaim = runPage.getByText('需要核对的综述结论',{exact:true}).locator('../..').locator('..');
  await targetClaim.getByRole('button',{name:'逐条审阅',exact:true}).click();
  await runPage.getByLabel('Claim 评估理由').fill('保留未提交的人工笔记');
  await targetClaim.getByRole('button',{name:'查看证据关系',exact:true}).click();
  const relation = runPage.getByRole('region',{name:'当前论断的证据关系'});
  const supports = relation.getByRole('group',{name:'支持',exact:true});
  await supports.getByText('原文位置 结果段',{exact:false}).waitFor();
  assert.equal(await supports.getByRole('link',{name:'样板来源'}).getAttribute('href'),'https://doi.org/10.9999/qa');
  await relation.getByRole('group',{name:'反驳',exact:true}).getByText('原文位置 讨论段').waitFor();
  await relation.getByRole('group',{name:'待评估',exact:true}).getByText('未找到来源（paper-missing）').waitFor();
  await targetClaim.getByRole('button',{name:'收起证据关系',exact:true}).click();
  assert.equal(await relation.count(),0);
  assert.equal(await runPage.getByLabel('Claim 评估理由').inputValue(),'保留未提交的人工笔记');
  const unlinked = runPage.getByText('没有证据的样板结论',{exact:true}).locator('../..').locator('..');
  await unlinked.getByRole('button',{name:'查看证据关系',exact:true}).click();
  await relation.getByText(/尚无关联证据/).waitFor();
  await runPage.unroute('**/dsh-research-kit/evidence-sync?**');
  console.log('论断卡片按立场追溯原文、收起后保留审阅草稿：通过');
  await runPage.getByRole('tab',{name:'本次研究',exact:true}).click();
  await runPage.getByRole('button',{name:'做文献综述'}).click();
  await runPage.getByLabel('综述问题',{exact:true}).fill('图书馆开放时段与读者体验');
  await runPage.getByRole('button',{name:'在新会话开始',exact:true}).click();
  const launch = await runPage.evaluate(()=>window.launchDraft);
  assert.equal(launch.whenDraftExists, 'append');
  assert.match(launch.prompt, /图书馆开放时段与读者体验/);
  assert.match(launch.prompt, /研究运行/);
  await runContext.close();
  console.log('跨会话恢复原运行、继续草稿、新会话预填、原生文件引用与综述审核导出：通过');

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

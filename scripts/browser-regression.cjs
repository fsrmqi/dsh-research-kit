const { chromium } = require('playwright');
const fs = require('fs');
const http = require('http');
const assert = require('node:assert/strict');
const path = require('node:path');
const repo = path.resolve(__dirname, '..');
const artifacts = path.join(repo, 'browser-results');
fs.mkdirSync(artifacts, { recursive: true });
const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>科研工作台回归验证</title><div id="root"></div><div id="composer" data-composer-card style="position:fixed;bottom:12px;left:12px;width:min(560px,calc(100vw - 24px));z-index:30000"></div>
<script src="/react"></script><script src="/react-dom"></script>
<script>window.__ModuleLoader__={load({factory}){window.plugin=factory(()=>React)}};</script>
<script src="/bundle"></script><script>
const registered={}; plugin.apply({slots:{inject(n,fn){fn();return ()=>{}},register(o,c){registered[o.id]=c;return ()=>{}}}});
const actions={setDraft(s){window.draft=s},submit(){}};
ReactDOM.createRoot(document.getElementById('composer')).render(React.createElement(React.Fragment,null,React.createElement(registered['dsh-research-kit-launcher']),React.createElement(registered['dsh-research-kit-overlay'],{sessionId:'qa',inputActions:actions})));
window.draft=''; window.root=ReactDOM.createRoot(document.getElementById('root'));
root.render(React.createElement(registered['dsh-research-kit-console'],{sessionId:'qa',inputActions:{setDraft(s){window.draft=s},submit(){}}}));
</script>`;
const server = http.createServer((req,res)=>{
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
  await page.screenshot({path:path.join(artifacts,'desktop.png'),fullPage:false});
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:path.join(artifacts,'mobile.png'),fullPage:false});
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

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { installDomStub } from './helpers/dom-stub.js'

installDomStub()

const { ConfirmDangerButton, CopyButton } = await import('../src/ui.js')

const read = rel => readFileSync(new URL(rel, import.meta.url), 'utf8')

test('基础交互原语：ConfirmDangerButton 初始不处于确认态，CopyButton 正常渲染', () => {
  const dangerHtml = renderToStaticMarkup(createElement(ConfirmDangerButton, { label: '删除', confirmLabel: '确认删除？', onConfirm: () => {} }))
  assert.match(dangerHtml, /删除/)
  assert.doesNotMatch(dangerHtml, /确认删除？/, '初始渲染不得误处危险确认态')
  const copyHtml = renderToStaticMarkup(createElement(CopyButton, { label: '复制', getText: () => 'hello' }))
  assert.match(copyHtml, /复制/)
})

test('系统替人判断与执行：一键保存证据、自动记入检索、引用文件自动解析', () => {
  const dbPanel = read('../src/database-query-panel.js')
  assert.match(dbPanel, /quickSaveEvidence/, '数据库查询面板应支持一键保存证据')
  assert.match(dbPanel, /actionLabel:\s*'撤销'/, '一键保存证据应支持 Toast 撤销')
  assert.match(dbPanel, /kind:\s*'search'/, '查询结果应自动记录到检索账本')
  assert.doesNotMatch(dbPanel, /记录本次检索到账本/, '不应再要求用户手动点击记录本次检索')

  const sections = read('../src/evidence-vault-sections.js')
  assert.match(sections, /previewCitations\(text\)/, '选择引用文件后应自动触发解析预览')
  assert.match(sections, /补充研究细节/, '建立论断表单应渐进展开次要字段')
})

test('降噪与不打断：证据库静默刷新、默认收起引用预览、自动梦境不撑高页面', () => {
  const vaultPane = read('../src/research-evidence-vault.js')
  assert.match(vaultPane, /if \(!entriesCountRef\.current\) setLoading\(true\)/, '已有数据时刷新不应闪回全屏加载态')
  assert.match(vaultPane, /selectedEntries\.length && citationPreviewOpen/, '勾选证据不应默认占半屏展开引用块预览')
  assert.match(vaultPane, /onNavigate\('vault', \{ tab: 'assets', assetId: ref\.assetId \}\)/, '被引用于应支持直接跳转对应灵感资产')

  const dream = read('../src/research-dream-panel.js')
  assert.match(dream, /running && autoRunning/, '自动梦境应在标题栏轻提示而不插入撑高页面的 Spinner')
  assert.match(dream, /running && !autoRunning/, '只有手动整理才显示完整 Spinner')

  const overlay = read('../src/composer-overlay.js')
  assert.match(overlay, /← 返回列表/, '流程配置弹窗应支持返回列表不丢搜索词')
  assert.doesNotMatch(overlay, /复制 Prompt/, '全站应统一为「复制提示词」')
})

test('统一确认、可收回与星图瘦身：useDismissable、浮动缩放条、课题上下文同步与自然文案', () => {
  const deposit = read('../src/message-deposit-action.js')
  assert.match(deposit, /useDismissable\(Boolean\(preview\)/, '回答依据浮层应支持 Esc 与外点关闭')

  const graph = read('../src/research-evidence-graph.js')
  assert.match(graph, /subscribeResearchContext/, '星图课题筛选应跟随全局课题上下文')
  assert.match(graph, /rk-graph-floating-controls/, '缩放控制应浮动在画布右下角')
  assert.match(graph, /rk-popover-menu/, '星图高级筛选应收进弹出面板')

  const graphPanels = read('../src/evidence-graph-panels.js')
  assert.match(graphPanels, /ConfirmDangerButton/, '星图详情删除应使用统一危险确认按钮')

  const status = read('../src/plugin-status.js')
  assert.doesNotMatch(status, /部署事实 · 不改变目录标注/, '状态页应使用面向研究者的自然文案')

  const form = read('../src/workbench-workflow-form.js')
  assert.match(form, /stages-preview/, '未启动工作流前应以步骤列表而非禁用复选框展示计划')
})

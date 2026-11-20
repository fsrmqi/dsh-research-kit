// 宿主导航接线的纯逻辑测试：不 import React，也不依赖真实宿主。
//
// 两条通道都靠「服务装配了才渲染入口」降级，所以测试要同时钉住正路径（调用顺序与参数）
// 和降级路径（返回 false 而不是抛错）——UI 靠 false 决定「点了没反应」还是「整块不渲染」。

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  currentMainSessionId,
  insertResearchMaterial, researchMaterialInput,
  launchResearchSession,
  returnToConversation,
  supportsSessionLaunch,
} from '../src/lib/host-navigation.js'

const VIEW = 'dsh-research-kit-console'

function sessionsWith(rows) {
  return { list: { getSnapshot: () => ({ byId: rows }) } }
}

test('currentMainSessionId 只认主区持有的会话', () => {
  assert.equal(currentMainSessionId(sessionsWith({
    a: { id: 'a', retainedBy: { mainView: 0 } },
    b: { id: 'b', retainedBy: { mainView: 1 } },
    c: { id: 'c', retainedBy: {} },
  })), 'b')
  assert.equal(currentMainSessionId(sessionsWith({})), '')
  assert.equal(currentMainSessionId(undefined), '')
  assert.equal(currentMainSessionId({ list: { getSnapshot: () => { throw new Error('no snapshot') } } }), '')
})

test('returnToConversation 先切回当前会话，再尽力激活目标视图', () => {
  const calls = []
  const sessions = sessionsWith({ s1: { id: 's1', retainedBy: { mainView: 1 } }, s2: { id: 's2', retainedBy: { mainView: 0 } } })
  const uiWorkspace = { openSession: target => calls.push(['open', target]) }
  const uiConversation = {
    binding: id => {
      calls.push(['binding', id])
      return { activate: view => calls.push(['activate', view]) }
    },
  }
  assert.equal(returnToConversation({ uiWorkspace, uiConversation, sessions, view: VIEW }), true)
  // 顺序不能反：先 binding 会抛 inactive session（宿主在 openSession 里同步 retain）。
  assert.deepEqual(calls, [['open', 's1'], ['binding', 's1'], ['activate', VIEW]])
})

test('returnToConversation：视图激活是加分项，缺绑定服务时仍算导航成功', () => {
  const sessions = sessionsWith({ s1: { id: 's1', retainedBy: { mainView: 1 } } })
  const uiWorkspace = { openSession: () => {} }
  // 标签选中由宿主会话 store 决定，跨页只能尽力激活；没有 binding 服务不该让按钮显示「暂不可用」。
  assert.equal(returnToConversation({ uiWorkspace, sessions, view: VIEW }), true)
  const throwing = { binding: () => { throw new Error('inactive session') } }
  assert.equal(returnToConversation({ uiWorkspace, uiConversation: throwing, sessions, view: VIEW }), true)
  const noActivate = { binding: () => ({}) }
  assert.equal(returnToConversation({ uiWorkspace, uiConversation: noActivate, sessions, view: VIEW }), true)
})

test('returnToConversation 在通道缺失或没有主区会话时返回 false，不抛错', () => {
  const sessions = sessionsWith({ s1: { id: 's1', retainedBy: { mainView: 1 } } })
  assert.equal(returnToConversation(), false)
  assert.equal(returnToConversation({ sessions }), false)
  assert.equal(returnToConversation({ sessions: sessionsWith({}), uiWorkspace: { openSession: () => {} }, view: VIEW }), false)
  const refusing = { openSession: () => { throw new Error('refused') } }
  assert.equal(returnToConversation({ uiWorkspace: refusing, sessions, view: VIEW }), false)
})

test('supportsSessionLaunch 认 `conversation` 服务上的草稿初始化通道（不是 uiConversation）', () => {
  // 回归：宿主把 `input` 挂在 `conversation` 服务（service.ts 的 ConversationController），
  // `uiConversation` 服务没有 input。探错服务会让入口在任何宿主上都不渲染。
  const uiWorkspace = { startSession: () => {} }
  const conversation = { input: { requestDraftInitialization: () => 'applied' } }
  assert.equal(supportsSessionLaunch({ uiWorkspace, conversation }), true)
  assert.equal(supportsSessionLaunch({ uiWorkspace }), false)
  assert.equal(supportsSessionLaunch({ uiWorkspace, conversation: { input: {} } }), false)
  assert.equal(supportsSessionLaunch({ conversation }), false)
  assert.equal(
    supportsSessionLaunch({ uiWorkspace, uiConversation: conversation }),
    false,
    'uiConversation 上没有 input，不能把它当成草稿通道',
  )
})

test('launchResearchSession 开新会话并预填草稿（默认 append，0.2.1-rc.3+ 才识别该字段）', () => {
  const calls = []
  const host = {
    uiWorkspace: { startSession: (...args) => calls.push(args) },
    conversation: { input: { requestDraftInitialization: () => 'applied' } },
  }
  assert.equal(launchResearchSession(host, { prompt: '研究问题：水稻耐盐性的遗传基础' }), true)
  assert.deepEqual(calls[0], [undefined, { prompt: '研究问题：水稻耐盐性的遗传基础', whenDraftExists: 'append' }])
  assert.equal(launchResearchSession(host, { prompt: '补充材料', whenDraftExists: 'replace' }), true)
  assert.equal(calls[1][1].whenDraftExists, 'replace')
})

test('launchResearchSession 在提示词为空、通道缺失或宿主抛错时返回 false', () => {
  const host = {
    uiWorkspace: { startSession: () => { throw new Error('refused') } },
    conversation: { input: { requestDraftInitialization: () => 'applied' } },
  }
  assert.equal(launchResearchSession(host, { prompt: '  ' }), false)
  assert.equal(launchResearchSession(host, { prompt: '内容' }), false)
  assert.equal(launchResearchSession({}, { prompt: '内容' }), false)
  assert.equal(launchResearchSession({ uiWorkspace: { startSession: () => {} } }, { prompt: '内容' }), false)
})

test('原生材料引用只写入绑定会话的可编辑草稿，并兼容旧宿主', () => {
  assert.equal(researchMaterialInput({}, 's1'), null)
  const context = {}
  let editable = true
  let captured
  const host = {
    sessions: { binding: id => id === 's1' ? { ctx: context } : undefined },
    conversation: { input: { for(ctx) {
      assert.equal(ctx, context)
      return {
        canInsertReferences: () => editable,
        addReferences: references => { captured = references; return true },
      }
    } } },
  }
  assert.throws(() => insertResearchMaterial(host, 's1', '../outside.pdf'), /相对文件路径/)
  assert.throws(() => insertResearchMaterial(host, 's2', 'paper.pdf'), /无法添加/)
  insertResearchMaterial(host, 's1', '文献/论文 一.pdf')
  assert.deepEqual(captured, [{
    source: 'reference', ref: '@"文献/论文 一.pdf"', label: '论文 一.pdf', appearance: 'file', clipboardText: '@"文献/论文 一.pdf"',
  }])
  editable = false
  assert.throws(() => insertResearchMaterial(host, 's1', 'paper.pdf'), /无法添加/)
})

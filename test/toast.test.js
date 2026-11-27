import test from 'node:test'
import assert from 'node:assert/strict'
import { pushToast, dismissToast, clearToasts, getToasts, subscribeToasts } from '../src/lib/toast.js'

test('pushToast 推送、订阅与手动关闭正常工作', () => {
  clearToasts()
  const snapshots = []
  const unsubscribe = subscribeToasts(list => snapshots.push(list.map(item => item.message)))
  const id = pushToast({ message: '已保存', durationMs: 0 })
  assert.ok(id)
  assert.equal(getToasts().length, 1)
  assert.equal(getToasts()[0].message, '已保存')
  assert.equal(dismissToast(id), true)
  assert.equal(getToasts().length, 0)
  assert.equal(dismissToast(id), false)
  unsubscribe()
  assert.deepEqual(snapshots, [['已保存'], []])
})

test('pushToast 最多同时保留 3 条，超限时淘汰最早的一条', () => {
  clearToasts()
  pushToast({ message: '第一条', durationMs: 0 })
  pushToast({ message: '第二条', durationMs: 0 })
  pushToast({ message: '第三条', durationMs: 0 })
  pushToast({ message: '第四条', durationMs: 0 })
  assert.deepEqual(getToasts().map(item => item.message), ['第二条', '第三条', '第四条'])
  clearToasts()
})

test('pushToast 支持撤销动作并在空消息时忽略', () => {
  clearToasts()
  assert.equal(pushToast({ message: '   ' }), '')
  assert.equal(getToasts().length, 0)
  let undone = false
  const id = pushToast({
    message: '已清空表单',
    actionLabel: '撤销',
    onAction: () => { undone = true },
    durationMs: 0,
  })
  const entry = getToasts().find(item => item.id === id)
  assert.equal(entry.actionLabel, '撤销')
  entry.onAction()
  assert.equal(undone, true)
  clearToasts()
})

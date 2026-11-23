import { expect, test } from 'claude-code/testing'

import { askedAfter } from '../hooks/confirm'
import { listify, splitAsk } from '../hooks/views'
import type { ReplyRow } from '../types'

const PANE = {
  plugin: 'chief',
  component: 'Pane',
  requestId: 'chief',
  props: { title: 'chief', isFocused: false, bodyColumns: 70, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
} as const

// 插件自己的存储（钥匙放在这）：测试里用内存的。
function memStore(on: Parameters<Parameters<typeof test>[1]>[1]) {
  const kv = new Map<string, unknown>()
  on('store.get', (_, e) => ({ value: kv.get(e.key) }))
  on('store.set', (_, e) => {
    kv.set(e.key, e.value)
    return { value: undefined }
  })
}

const now = new Date().toISOString()
const FILES: Record<string, string> = {
  '/Users/me/chief/data/alive.json': JSON.stringify({ at: now }),
  '/Users/me/chief/data/engine.json': JSON.stringify({ at: now, health: { slack: { ok: true, at: now, fails: 0 }, github: { ok: false, at: now, fails: 1, error: 'gh 出错了：check your internet connection' } } }),
  '/Users/me/chief/data/state.json': JSON.stringify({ nextId: 11 }),
  '/Users/me/chief/data/dispatch.json': JSON.stringify({ 1: {}, 2: {}, 3: {}, 4: {}, 5: {}, 6: {}, 7: {}, 8: {} }),
  '/Users/me/chief/data/things.json': JSON.stringify({
    things: [
      { id: 1, title: 'PROJ-479 接口改造', session: 'local_abc', status: 'waiting_you', progress: '改完了，等你定上线时间', next: '等你定了就提测', blocker: '等后端接口', results: ['[PR #12](https://github.com/o/r/pull/12)'], due: new Date().toISOString().slice(0, 10), events: [9], updatedAt: now, log: [{ at: now, text: '开了会话' }, { at: now, text: '改完了，等你定上线时间' }] },
      { id: 2, title: 'o/r#3 review', session: 'local_def', status: 'done', progress: '已批准', events: [10], updatedAt: now, log: [] },
    ],
    asks: [{ id: 3, thing: 1, question: 'Joe 问能不能本周上线', suggest: '回复下周二上线', status: 'open', at: now, reply: 5 }],
  }),
  '/Users/me/chief/data/replies.json': JSON.stringify({
    items: [
      { id: 5, event: 9, thing: 1, source: 'slack', target: { channel: 'D1', ts: '1.0' }, context: { who: 'Bob Chen', where: 'Bob Chen 的私信', said: '压测那个你处理了吗', url: null }, body: '处理了，报告在 thread 里', status: 'pending', at: now },
      { id: 7, kind: 'approve', event: 11, source: 'github', target: { ref: 'o/r#44' }, context: { who: 'Alice', where: '#proj', said: '帮忙看下 PR', url: 'https://github.com/o/r/pull/44' }, body: '', status: 'pending', at: now },
      { id: 6, event: 10, source: 'github', target: { ref: 'o/r#3' }, context: { who: null, where: 'o/r#3 修 bug', said: 'PR o/r#3', url: null }, body: 'LGTM', status: 'sent', by: 'you', sentAt: now, at: now },
    ],
  }),
  '/Users/me/chief/data/decisions.jsonl': [
    { at: now, event: 1, scenario: 'slack_dm', verdict: 'forwarded', reason: 'Bob 问压测进度，送进了压测会话', what: { source: 'slack', title: '私信', from: 'Bob Chen', text: '压测那个你处理了吗' } },
    { at: now, event: 2, scenario: 'slack_thread', verdict: 'noted', reason: 'Alice 只是同步看板 ready', what: { source: 'slack', title: '#proj', from: 'Alice', text: '看板 ready 了' } },
    { at: now, event: 3, scenario: 'slack_thread', verdict: 'ignored', reason: '没点你名的闲聊' },
  ].map(d => JSON.stringify(d)).join('\n'),
  '/Users/me/chief/data/reviews.json': JSON.stringify({ 3: { ok: true, at: now } }),
  '/Users/me/chief/data/sources.json': JSON.stringify({ slack: true, github: true }),
  '/Users/me/chief/data/activity.json': JSON.stringify({ local_abc: { at: new Date(Date.now() + 1000).toISOString(), title: 'x', last: '接口联调完了，在等后端发版', permissionMode: 'bypassPermissions', archived: false }, _hub: { permissionMode: 'auto' } }),
  '/Users/me/chief/rules.json': JSON.stringify({
    scenarios: { slack_self: { handle: 'command', reply: 'auto' }, slack_dm: { handle: 'dispatch', reply: 'ask' }, slack_thread: { handle: 'note', reply: 'ask' } },
    custom: [{ id: 1, when: 'Slack 里有人发 PR 链接让我看', handle: 'approve', reply: 'auto' }],
    notes: ['涉及排期的都要问我'],
    proposals: [{ id: 1, text: 'Alice 在项目频道问进度时派活', basis: '你标错了 #2', at: now }],
  }),
}

test('面板：主会话状态、要你定、待发出；按钮各做各的', async ($, on) => {
  const runs: { argv: string[]; stdin?: string }[] = []
  const prompts: string[] = []
  on('command.register', () => ({ value: { command: 'chief' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  memStore(on)
  on('clock.every', () => ({ value: { cancel: () => {} } }))
  on('fs.read', (_, e) => {
    if (e.path === '/Users/me/chief/data/bin/chief') return { value: '#!/bin/sh' }
    const text = FILES[e.path]
    if (text === undefined) throw new Error('missing')
    return { value: text }
  })
  on('process.run', (_, e) => {
    runs.push({ argv: [...e.argv], ...(e.init?.stdin !== undefined ? { stdin: e.init.stdin } : {}) })
    if (e.argv[0] === '/usr/bin/env') return { value: { exitCode: 0, stdout: 'HOME=/Users/me\nPATH=/usr/bin\n', stderr: '' } }
    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })
  on('prompt.submit', (_, e) => {
    prompts.push(e.text)
    return { text: e.text }
  })
  const fills: string[] = []
  on('prompt.fill', (_, e) => {
    fills.push(e.text)
    return { isFilled: true }
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'chief', args: '' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /主会话在听/ })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /2 条等判断/ })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /判断了 3 条 · 派人去办 1 · 只记下 1 · 忽略 1 · 替你发出 1/ })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /今天截止/ })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /Joe 问能不能本周上线/ })).toBeTruthy()
    // 等你确认的回复直接在「现在要你」里。
    expect(await ui.find({ type: 'Text', text: /等你确认再发 · 2/ })).toBeTruthy()
    await ui.unmount()
  }

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  // 问题挂着的回复：显示回谁、说什么，不显示回复号。
  expect(await ui.find({ type: 'Text', text: /相关的待发出：回 Bob Chen「处理了，报告在 thread 里」/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /#5/ })).toBeFalsy()
  // 要你定的卡片只有三条路：照建议办、看细节、写你的决定发送；没有批注。
  expect(await ui.find({ key: 'ok3' })).toBeTruthy()
  expect(await ui.find({ key: 'an-a3' })).toBeFalsy()
  // 拍板先在 chief 里记下（卡片马上收起），再交给主会话转告。
  await ui.press({ key: 'ok3' })
  expect(runs.some(r => r.argv.slice(1).join(' ') === 'ask answer 3' && r.stdin === '照建议办')).toBe(true)
  expect(prompts.at(-1)).toBe('chief：问题 #3 照建议办')
  await ui.input({ key: 'in3', text: '下周三，我来回' })
  expect(runs.some(r => r.argv.slice(1).join(' ') === 'ask answer 3' && r.stdin === '下周三，我来回')).toBe(true)
  expect(prompts.at(-1)).toBe('chief：问题 #3 的回答：下周三，我来回')

  await ui.press({ key: 'tab-outbox' })
  expect(await ui.find({ type: 'Text', text: /压测那个你处理了吗/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /你点的发送 · 回 o\/r#3 修 bug：LGTM/ })).toBeTruthy()

  // 稿子按发出去的样子显示，点「改稿」才变成输入框；改了再发：先存改后的稿子（标准输入），再排队。
  await ui.press({ key: 'ed5' })
  await ui.input({ key: 'body5', text: '处理了，报告发你私信了', kind: 'change' })
  await ui.press({ key: 'sd5' })
  // 你自己改的稿子带着钥匙交给 chief（edit-yours），引擎照原样收，不按「不许写 chief 编号」拦你自己写的话。
  const edit5 = runs.slice(-4).find(r => r.argv.slice(1).join(' ') === 'reply edit-yours 5')
  expect(edit5).toBeTruthy()
  expect(JSON.parse(edit5!.stdin ?? '{}')).toMatchObject({ text: '处理了，报告发你私信了' })
  expect(JSON.parse(edit5!.stdin ?? '{}').key).toMatch(/^[0-9a-f]{64}$/)
  // 面板上点的发送：带着插件的钥匙以你的名义发（主会话自己发不了 confirmed by 你）。
  const sent5 = runs.slice(-4).find(r => r.argv.slice(1).join(' ') === 'reply confirm 5')
  expect(sent5).toBeTruthy()
  expect(JSON.parse(sent5!.stdin ?? '{}')).toMatchObject({ how: 'panel' })
  expect(JSON.parse(sent5!.stdin ?? '{}').key).toMatch(/^[0-9a-f]{64}$/)
  // 改过稿子才发：告诉主会话，让它从你的改动里学写法。
  expect(prompts.at(-1)).toBe('chief：回复 #5 你改过再发的')

  // 让它重写：点了才出输入框。
  await ui.press({ key: 'rw5' })
  await ui.input({ key: 'rd5', text: '语气太硬，客气点' })
  expect(runs.some(r => r.argv.slice(1).join(' ') === 'reply redo 5' && r.stdin === '语气太硬，客气点')).toBe(true)
  expect(prompts.at(-1)).toBe('chief：回复 #5 重写：语气太硬，客气点')

  // 待发出也没有批注：要改就「改稿」或「让它重写」。
  expect(await ui.find({ key: 'an-r5' })).toBeFalsy()
  await ui.press({ key: 'dp5' })
  expect(runs.at(-1)?.argv.slice(1).join(' ')).toBe('reply drop 5')

  // approve 也在待发出里，按钮写 approve。
  expect(await ui.find({ type: 'Text', text: /approve PR o\/r#44/ })).toBeTruthy()
  await ui.press({ key: 'sd7' })
  expect(runs.at(-1)?.argv.slice(1).join(' ')).toBe('reply confirm 7')

  // 进度：最上面一句重点；要关注的单独成卡，写清原因、还差什么，能直接动手。
  await ui.press({ key: 'tab-things' })
  expect(await ui.find({ type: 'Text', text: /最要紧：PROJ-479 接口改造 今天截止，卡在等后端接口/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /还差/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /等你定了就提测/ })).toBeTruthy()
  // 你在子会话里推进的，面板也看得到；跳过权限模式的会话会提醒。
  expect(await ui.find({ type: 'Text', text: /接口联调完了，在等后端发版/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /权限模式不一样/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /1 件在做 · 1 件要关注 · 最近 7 天办完 1 件/ })).toBeTruthy()
  await ui.press({ key: 'import' })
  expect(prompts.at(-1)).toBe('chief：导入现在在做的事')
  // 进度页：卡片上批一句，先攒着不发，攒好了一起发给主会话。
  const before = prompts.length
  await ui.press({ key: 'an-t1' })
  await ui.input({ key: 'ai-t1', text: '今天下班前改完报告' })
  expect(prompts.length).toBe(before)
  expect(await ui.find({ type: 'Text', text: /要发给主会话的批注 · 1/ })).toBeTruthy()
  // 篮子里显示批在哪件事，不显示事情号；发给主会话的那句照旧带着编号，主会话靠它找到是哪件。
  expect(await ui.find({ type: 'Text', text: /【事情 PROJ-479 接口改造】/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /事情 #1/ })).toBeFalsy()
  await ui.press({ key: 'send-basket' })
  expect(prompts.at(-1)).toBe('chief：批注（1 条）\n1. 关于【事情 #1 PROJ-479 接口改造】：今天下班前改完报告')
  expect(await ui.find({ type: 'Text', text: /要发给主会话的批注/ })).toBeFalsy()
  await ui.press({ key: 'ago1' })
  expect(runs.at(-1)?.argv).toEqual(['/usr/bin/open', 'claude://code/continue?session=local_abc'])
  await ui.press({ key: 'aask1' })
  expect(prompts.at(-1)).toMatch(/^chief：转告事情 #1：现在进展怎么样/)
  await ui.press({ key: 'adn1' })
  expect(runs.some(r => r.argv.slice(1).join(' ') === 'thing update 1 --status done')).toBe(true)
  await ui.press({ key: 'done-list' })
  expect(await ui.find({ type: 'Text', text: /1 件在做 · 1 件要关注/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /✓ o\/r#3 review/ })).toBeTruthy()

  // 策略：改场景、加情况、加规矩、采纳提议。
  await ui.press({ key: 'tab-policy' })
  await ui.select({ key: 'h-custom:1', value: 'dispatch' })
  expect(runs.at(-1)?.argv.slice(1).join(' ')).toBe('rules set custom:1 handle=dispatch')
  await ui.input({ key: 'add-custom', text: 'Jira 上 QA 提的 bug 指给我' })
  expect(runs.some(r => r.argv.slice(1).join(' ') === 'rules custom add' && r.stdin === 'Jira 上 QA 提的 bug 指给我')).toBe(true)
  await ui.press({ key: 'rmc-custom:1' })
  expect(runs.at(-1)?.argv.slice(1).join(' ')).toBe('rules custom remove 1')
  expect(await ui.find({ type: 'Text', text: /Alice 在项目频道问进度时派活/ })).toBeTruthy()
  await ui.select({ key: 'm-slack_dm', value: 'auto' })
  expect(runs.at(-1)?.argv.slice(1).join(' ')).toBe('rules set slack_dm reply=auto')
  await ui.press({ key: 'eb-slack_dm' })
  await ui.input({ key: 'bf-slack_dm', text: '先查清楚再回，回复用中文' })
  expect(runs.some(r => r.argv.slice(1).join(' ') === 'rules brief slack_dm' && r.stdin === '先查清楚再回，回复用中文')).toBe(true)
  await ui.input({ key: 'add-rule', text: 'Bob 问进度可以直接回' })
  expect(runs.some(r => r.argv.slice(1).join(' ') === 'rules add' && r.stdin === 'Bob 问进度可以直接回')).toBe(true)
  await ui.press({ key: 'pa1' })
  expect(runs.at(-1)?.argv.slice(1).join(' ')).toBe('rules accept 1')
  await ui.press({ key: 'rm0' })
  expect(runs.some(r => r.argv.slice(1).join(' ') === 'rules remove' && r.stdin === '涉及排期的都要问我')).toBe(true)

  // 测评：数字、判断记录、标对错。
  await ui.press({ key: 'tab-eval' })
  expect(await ui.find({ type: 'Text', text: /替你做了/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /没打扰你就处理掉 2 条 · 派人去办 1 件/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /判断 3 条：派人去办 1 · 只记下 1 · 忽略 1/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /判断准确率：100%（标了 1 条，错 0）/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /你确认原样发 1/ })).toBeTruthy()
  await ui.press({ key: 'dt1' })
  await ui.press({ key: 'ok-1' })
  expect(runs.at(-1)?.argv.slice(1).join(' ')).toBe('review 1 ok')
  await ui.select({ key: 'sc-1', value: 'dispatch' })
  expect(runs.at(-1)?.argv.slice(1).join(' ')).toBe('eval from-event 1 dispatch')
  await ui.press({ key: 'dt2' })
  await ui.input({ key: 'wr-2', text: 'Alice 在问我负责的部分，要派活' })
  expect(runs.some(r => r.argv.slice(1).join(' ') === 'review 2 wrong' && r.stdin === 'Alice 在问我负责的部分，要派活')).toBe(true)
  expect(prompts.at(-1)).toBe('chief：判断 #2 错了：Alice 在问我负责的部分，要派活')

  // 设置（原来的控制页也在这）：脚本都变成按钮。
  await ui.press({ key: 'tab-setup' })
  // 来源连不上：标红，写出为什么。
  expect(await ui.find({ type: 'Text', text: /连不上（连着 1 次）/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /check your internet connection/ })).toBeTruthy()
  await ui.press({ key: 'eng-restart' })
  expect(runs.at(-1)?.argv.slice(1).join(' ')).toBe('engine restart')
  await ui.press({ key: 'hub-reload' })
  expect(prompts.at(-1)).toMatch(/^chief：重读规则。.*重新调用 chief:hub.*不用重新开张/)
  await ui.press({ key: 'hub-stop' })
  expect(runs.at(-1)?.argv.slice(1).join(' ')).toBe('hub stop')
  await ui.input({ key: 'test-msg', text: 'PERF-35121 的报告今天能给吗' })
  expect(runs.some(r => r.argv.slice(1).join(' ') === 'test --from 测试同事' && r.stdin === 'PERF-35121 的报告今天能给吗')).toBe(true)
  await ui.press({ key: 'cn-jira' })
  expect(runs.some(r => r.argv.slice(1).join(' ') === 'connect jira')).toBe(true)
  await ui.unmount()
})

test('主会话没在听：说清楚怎么办，积多了能一键跳过', async ($, on) => {
  const runs: string[] = []
  on('command.register', () => ({ value: { command: 'chief' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  memStore(on)
  on('clock.every', () => ({ value: { cancel: () => {} } }))
  on('fs.read', (_, e) => {
    if (e.path === '/Users/me/chief/data/bin/chief') return { value: '#!/bin/sh' }
    if (e.path.endsWith('state.json')) return { value: JSON.stringify({ nextId: 88 }) }
    if (e.path.endsWith('alive.json')) return { value: JSON.stringify({ at: '2026-01-01T00:00:00Z' }) }
    throw new Error('missing')
  })
  on('process.run', (_, e) => {
    runs.push(e.argv.join(' '))
    if (e.argv[0] === '/usr/bin/env') return { value: { exitCode: 0, stdout: 'HOME=/Users/me\nPATH=/usr/bin\n', stderr: '' } }
    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'chief', args: '' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /主会话没在听/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /引擎没在跑/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /新消息现在没人判断/ })).toBeTruthy()
  await ui.press({ key: 'skip-old' })
  expect(runs).toContain('/Users/me/chief/data/bin/chief mark --upto 87 ignored')
  expect(runs).toContain('/Users/me/chief/data/bin/chief cursor 87')
  await ui.unmount()
})

test('引擎还没装：只有设置页，按钮跑插件里的 setup.sh', async ($, on) => {
  const runs: string[] = []
  on('command.register', () => ({ value: { command: 'chief' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  memStore(on)
  on('clock.every', () => ({ value: { cancel: () => {} } }))
  on('fs.read', () => {
    throw new Error('missing')
  })
  on('process.run', (_, e) => {
    runs.push(e.argv.join(' '))
    if (e.argv[0] === '/usr/bin/env') return { value: { exitCode: 0, stdout: 'HOME=/Users/me\nPATH=/usr/bin\n', stderr: '' } }
    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'chief', args: '' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /设置 chief/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /现在要你/ })).toBeFalsy()
  await ui.press({ key: 'setup-engine' })
  expect(runs.some(r => r.startsWith('/bin/sh ') && r.endsWith('/setup.sh'))).toBe(true)
  await ui.unmount()
})

// 引擎跟着插件自动更新：插件一加载就比版本，旧了在后台跑 setup.sh，跑完弹一句；一样就什么都不做。
function autoUpdateWorld(on: Parameters<Parameters<typeof test>[1]>[1], engineVersion: string) {
  const runs: string[] = []
  const toasts: string[] = []
  on('command.register', () => ({ value: { command: 'chief' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  memStore(on)
  on('clock.every', () => ({ value: { cancel: () => {} } }))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('fs.read', (_, e) => {
    if (e.path.endsWith('/.claude-plugin/plugin.json')) return { value: JSON.stringify({ name: 'chief', version: '0.2.0' }) }
    if (e.path === '/Users/me/chief/data/app/VERSION') return { value: `${engineVersion}\n` }
    throw new Error('missing')
  })
  on('process.run', (_, e) => {
    runs.push(e.argv.join(' '))
    if (e.argv[0] === '/usr/bin/env') return { value: { exitCode: 0, stdout: 'HOME=/Users/me\nPATH=/usr/bin\n', stderr: '' } }
    return { value: { exitCode: 0, stdout: '装好了', stderr: '' } }
  })
  return { runs, toasts }
}

test('引擎比插件旧：一加载就自动更新，跑完弹一句', async ($, on) => {
  const w = autoUpdateWorld(on, '0.1.0')
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await new Promise(r => setTimeout(r, 50))
  expect(w.runs.some(r => r.startsWith('/bin/sh ') && r.endsWith('/setup.sh'))).toBe(true)
  expect(w.toasts).toContain('chief 引擎更新到 0.2.0 了')
})

test('引擎和插件一样新：什么都不做', async ($, on) => {
  const w = autoUpdateWorld(on, '0.2.0')
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await new Promise(r => setTimeout(r, 50))
  expect(w.runs.some(r => r.endsWith('/setup.sh'))).toBe(false)
  expect(w.toasts).toEqual([])
})

test('设置页：没记过 Slack 工作区时先问一句，填了从工作区登，留空也能登', async ($, on) => {
  const runs: string[] = []
  const doctor = {
    version: '0.2.0', node: 'v24.0.0', engine: 'running', chrome: true,
    sources: { slack: { enabled: false, ready: false }, github: { enabled: false, tool: true, ok: true, detail: '' }, jira: { enabled: false, tool: true, ok: true, detail: '' }, notion: { enabled: false, ready: false } },
    hub: { listening: false, lastAt: null }, awake: true, slackWorkspace: null, workspace: { path: '/Users/me/chief', ready: true },
  }
  on('command.register', () => ({ value: { command: 'chief' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  memStore(on)
  on('clock.every', () => ({ value: { cancel: () => {} } }))
  on('ui.toast', () => ({ value: undefined }))
  on('fs.read', (_, e) => {
    if (e.path === '/Users/me/chief/data/bin/chief') return { value: '#!/bin/sh' }
    if (e.path.endsWith('/.claude-plugin/plugin.json')) return { value: JSON.stringify({ version: '0.2.0' }) }
    if (e.path === '/Users/me/chief/data/app/VERSION') return { value: '0.2.0' }
    throw new Error('missing')
  })
  on('process.run', (_, e) => {
    const cmd = e.argv.join(' ')
    runs.push(cmd)
    if (e.argv[0] === '/usr/bin/env') return { value: { exitCode: 0, stdout: 'HOME=/Users/me\nPATH=/usr/bin\n', stderr: '' } }
    if (cmd.endsWith(' doctor')) return { value: { exitCode: 0, stdout: JSON.stringify(doctor), stderr: '' } }
    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'chief', args: '' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'tab-setup' })
  expect(await ui.find({ key: 'setup-slack' })).toBeFalsy()
  await ui.input({ key: 'slack-workspace', text: 'acme' })
  expect(runs).toContain('/Users/me/chief/data/bin/chief connect slack --workspace acme')
  await ui.input({ key: 'slack-workspace', text: '' })
  expect(runs).toContain('/Users/me/chief/data/bin/chief connect slack')
  await ui.unmount()
})

// 你在会话里说了「发吧」：主会话只能 ask-confirm，插件只放行你说完以后提的请求，你的话 15 分钟内有效。
test('会话里确认：只放行你说完话以后提的请求；还能发的才算；你的话过 15 分钟就不算了', async () => {
  const said = { at: Date.parse('2026-11-23T10:00:00Z') }
  const ask = (id: number, at: string, status = 'pending') => ({ id, status, confirmAsk: { at } }) as unknown as ReplyRow
  const items = [
    ask(1, '2026-11-23T09:59:00Z'),            // 你说话之前就提的
    ask(2, '2026-11-23T10:00:05Z'),            // 你说完以后提的
    ask(3, '2026-11-23T10:00:06Z', 'queued'),  // 已经在发了
    { id: 4, status: 'pending' } as unknown as ReplyRow, // 主会话没请求
  ]
  expect(askedAfter(items, said, said.at + 60_000)).toEqual([2])
  expect(askedAfter(items, said, said.at + 16 * 60_000)).toEqual([])
  expect(askedAfter(items, null, said.at)).toEqual([])
})

test('挤在一段里的几个问题拆成编号列表，日期和「第 9 层」不算编号', () => {
  const q = '前端方案里写明是占位英文、等 Ivy 定。两件事要你定：1 现在就改成「Processing」，还是等 Ivy 这批文案一起改？2 迁移栈第 9 层的 PR 描述里要不要补一段占位文案清单？'
  expect(listify(q)).toBe('前端方案里写明是占位英文、等 Ivy 定。两件事要你定：\n\n1. 现在就改成「Processing」，还是等 Ivy 这批文案一起改？\n2. 迁移栈第 9 层的 PR 描述里要不要补一段占位文案清单？')
  expect(listify('1 等 Ivy 这批一起改，她 25/26 号就给文案，省得改两次；2 补上，方便 review。')).toBe('1. 等 Ivy 这批一起改，她 25/26 号就给文案，省得改两次\n2. 补上，方便 review。')
  expect(listify('只有一件事：要不要等 1 天？')).toBe('只有一件事：要不要等 1 天？')
  expect(listify('已经分好行：\n1. 甲\n2. 乙')).toBe('已经分好行：\n1. 甲\n2. 乙')
})

test('问题拆成背景和要你定的：从第一个问号往前找最后一个句号', () => {
  expect(splitAsk('PROJ-35190 只提测了 RC 这一侧。OS 侧还在本地；Notion 那边另外跟进。现在要会话把 OS 侧也提 PR 吗？'))
    .toEqual({ context: 'PROJ-35190 只提测了 RC 这一侧。OS 侧还在本地；Notion 那边另外跟进。', ask: '现在要会话把 OS 侧也提 PR 吗？' })
  expect(splitAsk('由会话发还是你自己发？另外有两条要 PM 定。')).toEqual({ context: '', ask: '由会话发还是你自己发？另外有两条要 PM 定。' })
  expect(splitAsk('Joe 问能不能本周上线')).toEqual({ context: '', ask: 'Joe 问能不能本周上线' })
})

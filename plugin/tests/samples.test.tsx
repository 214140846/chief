import { expect, test } from 'claude-code/testing'

// 样式样例页（临时）：/chief samples 能打开，两个界面都画得出来、没被引擎跳过。
test('样式样例：/chief samples 打开，App 和终端都画得出来', async ($, on) => {
  on('command.register', () => ({ value: { command: 'chief' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('clock.every', () => ({ value: { cancel: () => {} } }))
  on('fs.read', (_, e) => {
    if (e.path === '/Users/me/chief/data/bin/chief') return { value: '#!/bin/sh' }
    throw new Error('missing')
  })
  on('process.run', (_, e) => {
    if (e.argv[0] === '/usr/bin/env') return { value: { exitCode: 0, stdout: 'HOME=/Users/me\nPATH=/usr/bin\n', stderr: '' } }
    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'chief', args: 'samples' })
  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ plugin: 'chief', component: 'Pane', requestId: 'chief', surface, props: { title: 'chief', isFocused: false, bodyColumns: 70, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} } } as never)
    expect(await ui.find({ type: 'Text', text: /^1\. 框的底色/ })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /^13\. Link/ })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /画不出来/ })).toBeFalsy()
    await ui.unmount()
  }
})

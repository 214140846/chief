// chief 面板：在「chief 消息中心」（你的私人助理主会话）旁边。六个页签：
//   现在要你：主会话在不在听、今天替你办了多少、要你定的事。
//   待发出：工作会话写好的回复，改了再发、不发、让它重写；发送后 5 秒内能撤回。
//   进度：每件事做到哪了、下一步、卡在哪、结果、截止日；导入你手上的事、问一遍进展。
//   策略：每种消息怎么办、回复要不要你确认、你的规矩、主会话提议的规矩。
//   测评：最近 7 天判断了多少、打扰你几次、准不准、稿子能不能原样用；每条判断能标对错。
//   控制：主会话、引擎、来源的开关，看日志，发测试消息。
//   设置：装引擎、登录 Slack、连 GitHub / Jira、开消息中心（setup.tsx）。引擎还没装时面板只有这一页。
// 数据直接读 ~/chief-home/data 里的文件（data.ts，每 3 秒一次）；动作在 actions.ts；画法在 views.tsx。
import { atom, read } from 'claude-code'
import type { EngineInterface as Engine, Register } from 'claude-code'

import { refresh, chiefDir } from './data'
import { checkSetup, missing, readSetup, setupTab } from './setup'
import { controlTab, evalTab, header, nowTab, outboxTab, policyTab, thingsTab, type Els } from './views'

const snap = atom({ plugin: 'chief', key: 'snap' } as const, null)
const note = atom({ plugin: 'chief', key: 'note' } as const, '')
const tab = atom({ plugin: 'chief', key: 'tab' } as const, 'now')
const edits = atom({ plugin: 'chief', key: 'edits' } as const, {})
const open = atom({ plugin: 'chief', key: 'open' } as const, [])
const logs = atom({ plugin: 'chief', key: 'logs' } as const, '')
const basket = atom({ plugin: 'chief', key: 'basket' } as const, [])

const PANE = 'chief'
const TITLE = 'chief'
// 保底：监听意外断了，每分钟也会重读一次。
const FALLBACK_MS = 60_000

let ticking = false
let watching = false

// 开始跟着数据刷新（插件重新加载、会话重启以后，面板还开着但监听没了，画的时候补上）。
// 挂一个 chief watch：~/chief-home/data 里有文件一变它就打一行，面板马上重读；不用一直去读。保底每分钟读一次。
async function startRefresh($: Engine) {
  if (!ticking) {
    ticking = true
    await checkSetup($)
    await refresh($)
    $.clock.every(FALLBACK_MS, () => refresh($))
  }
  if (!watching) {
    watching = true
    void watchChanges($)
  }
}

async function watchChanges($: Engine) {
  // 引擎还没装就没有 chief watch 可挂：等装好后下次画面板时再挂。
  if (!(await readSetup($)).installed) {
    watching = false
    return
  }
  try {
    const watcher = $.process.spawn({ argv: [`${await chiefDir($)}/bin/chief`, 'watch'] })
    for await (const piece of watcher) {
      if (piece.stream === 'stdout' && piece.text.includes('changed')) await refresh($)
    }
  } catch {
    // 起不来：只剩保底的每分钟一次。
  }
  // 监听停了（chief 被重装、进程被杀）：下次画面板时再挂上。
  watching = false
}

async function openPane($: Engine) {
  await $.ui.open({ id: PANE, title: TITLE })
  await checkSetup($)
  await refresh($)
  await startRefresh($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'chief', description: '打开 chief 面板：要你定的事、待发出、进度、策略、测评、控制、设置' })
    return next(e)
  })

  on('command.run', { command: 'chief' }, async $ => {
    await openPane($)
    return { text: 'chief 面板开好了。' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text } = ui
    // 画的时候出错：把原因画出来，而不是留一块空白。
    try {
      return await draw($, ui)
    } catch (error) {
      return (
        <Box flexDirection="column" padding="sm" gap="xs">
          <Text color="error">面板画不出来：{error instanceof Error ? error.message : String(error)}</Text>
          <Text dimColor wrap="wrap">把这句截图给我；先试试关掉面板再输入 /chief。</Text>
        </Box>
      )
    }
  })
}

async function draw($: Engine, ui: Els) {
  const { Box, Text } = ui
  {
    void startRefresh($)
    const st = await readSetup($)
    if (!st.installed) return <Box flexDirection="column" padding="sm">{setupTab($, ui, st)}</Box>
    const s = await read($, snap)
    if (s === null) return <Text dimColor>正在读 chief…</Text>
    const current = await read($, tab)
    const said = await read($, note)
    const opened = await read($, open)
    const body = current === 'outbox' ? outboxTab($, ui, s, await read($, edits), opened)
      : current === 'things' ? thingsTab($, ui, s, opened)
      : current === 'policy' ? policyTab($, ui, s, opened)
      : current === 'eval' ? evalTab($, ui, s, opened)
      : current === 'control' ? controlTab($, ui, s, await read($, logs))
      : current === 'setup' ? setupTab($, ui, st)
      : nowTab($, ui, s, opened, await read($, edits))
    return (
      <Box flexDirection="column" padding="sm">
        {header($, ui, s, said, current, await read($, basket), missing(st))}
        {body}
      </Box>
    )
  }
}

// 「要你」页：所有要你动手的事都在这一页（算法在 inbox.ts）。
//   最上面是 chief 自己的事（钥匙被动过、引擎 / 主会话 / 来源出了问题、插件更新了要重读规则、它提议的规矩），每条带一个能直接解决的按钮。
//   下面一件事一张卡，这件事等你的都在卡里：会话停在对话框上等你点、要你定的问题、等你确认的回复；最急的在前。
//   空的时候说一句没事，最底下一行是今天替你办了多少。
import type { EngineInterface as Engine } from 'claude-code'

import type { AskRow, DecisionRow, Snapshot } from '../../types'
import { ackKeyAlerts, answerAll, answerAsk, decideProposal, dismissAsk, engineDo, openSession, reopenAsk, setTab, skipOld, tell, toggle } from '../actions'
import { markReread } from '../data'
import { inboxOf, type Card, type SysItem } from '../inbox'
import { sourceName, t } from '../i18n'
import { RELOAD_SKILL, ago, dueLabel, listify, replyGist, short, splitAsk, startOfToday, whatOf, type Els } from '../ui'
import { replyCard, sendingRow } from './outbox'

export function nowTab($: Engine, ui: Els, s: Snapshot, opened: string[] = [], edit: Record<string, string> = {}) {
  const { Box, Text, Button } = ui
  const w = t().now
  const box = inboxOf(s)
  const dayStart = startOfToday()
  const today = s.decisions.filter(d => Date.parse(d.at) >= dayStart)
  const count = (...v: DecisionRow['verdict'][]) => today.filter(d => v.includes(d.verdict)).length
  const sentToday = s.replies.filter(r => r.status === 'sent' && r.sentAt !== undefined && Date.parse(r.sentAt) >= dayStart).length

  // ── chief 自己的事：一条一行，说清怎么了，带一个能直接解决的按钮 ──
  const sysRow = (x: SysItem, i: number) => {
    const row = (color: 'error' | 'warning' | undefined, text: string, help: string | null, ...buttons: unknown[]) => (
      <Box key={`sys${i}`} flexDirection="column" gap="xs" marginTop={i > 0 ? 'sm' : undefined}>
        <Text weight="semibold" color={color} wrap="wrap">{text}</Text>
        {help && <Text size="footnote" dimColor wrap="wrap">{help}</Text>}
        {buttons.some(Boolean) && <Box flexDirection="row" gap="sm" flexWrap="wrap">{buttons as never}</Box>}
      </Box>
    )
    const hd = t().header
    switch (x.kind) {
      case 'key':
        return row('error', `${hd.keyTitle}：${x.what === 'reset' ? hd.keyReset : hd.keySet}（${ago(x.at)}）`, hd.keyHelp, <Button key="ack-key" onPress={() => ackKeyAlerts($, x.at)}>{hd.keyAck}</Button>)
      case 'corrupt':
        return row('error', hd.corruptWhy(x.why || t().noReason), null, <Button key="sys-corrupt" onPress={() => setTab($, 'setup')}>{w.toSetup}</Button>)
      case 'engine':
        return row('error', w.engineDown, null, <Button key="sys-engine" variant="primary" onPress={() => engineDo($, 'start')}>{w.startEngine}</Button>)
      case 'hub':
        return row('warning', w.hubDown(ago(x.lastAt), x.unhandled), hd.hubDownHelp, x.unhandled > 20 ? <Button key="skip-old" onPress={() => skipOld($, s.maxEvent)}>{hd.skipOld(x.unhandled)}</Button> : null)
      case 'source':
        return row('error', w.sourceDown(sourceName(x.id), short(x.why || t().noReason, 80)), null, <Button key={`sys-src-${x.id}`} onPress={() => setTab($, 'setup')}>{w.toSetup}</Button>)
      case 'reread':
        return row(undefined, w.reread, null, <Button key="sys-reread" variant="primary" onPress={() => { void tell($, RELOAD_SKILL, w.rereadButton); void markReread($) }}>{w.rereadButton}</Button>)
      case 'proposal':
        return row(undefined, w.proposal(x.text), x.basis ? t().policy.basis(x.basis) : null,
          <Button key={`pa${x.id}`} variant="primary" onPress={() => decideProposal($, x.id, true)}>{t().policy.accept}</Button>,
          <Button key={`pr${x.id}`} onPress={() => decideProposal($, x.id, false)}>{t().policy.reject}</Button>)
    }
  }

  // ── 一个问题：一句背景（长的点开看）、要你定的加粗、一行建议；照办、不同意（点开才有输入框）、不用问了 ──
  const askRow = (q: AskRow, fresh: boolean) => {
    const linked = q.reply === undefined ? undefined : s.replies.find(r => r.id === q.reply)
    const { context, ask } = splitAsk(q.question)
    const ctxOpen = opened.includes(`ctx${q.id}`)
    const typing = opened.includes(`dis${q.id}`)
    return (
      <Box key={`q${q.id}`} flexDirection="column" gap="xs" marginTop="xs">
        {context !== '' && (
          <Box flexDirection="row" gap="xs" alignItems="flex-start">
            <Box flexGrow={1} flexShrink={1}><Text size="footnote" dimColor wrap={ctxOpen ? 'wrap' : 'truncate-end'}>{context}</Text></Box>
            {context.length > 40 && <Button key={`cx${q.id}`} plain onPress={() => toggle($, `ctx${q.id}`)}>{ctxOpen ? t().less : t().expand}</Button>}
          </Box>
        )}
        {/* 旧的问题里可能还列着好几问：照原样分行。 */}
        <Text weight="semibold" wrap="wrap">{fresh && <Text color="warning">{w.fresh} </Text>}? {listify(ask)}</Text>
        {q.suggest !== '' && <Text size="footnote" wrap="wrap"><Text dimColor>{w.suggest}{t().gap}</Text>{listify(q.suggest)}</Text>}
        {linked && <Text size="footnote" dimColor wrap="wrap">{w.linked(replyGist(linked))}</Text>}
        <Box flexDirection="row" gap="sm" alignItems="center">
          {q.suggest !== '' && (
            <Button key={`ok${q.id}`} variant="primary" onPress={() => answerAsk($, q.id, '照建议办', w.ok, `chief：问题 #${q.id} 照建议办`)}>{w.ok}</Button>
          )}
          <Button key={`no${q.id}`} onPress={() => toggle($, `dis${q.id}`)}>{w.disagreeShort}</Button>
          <Button key={`dm${q.id}`} plain onPress={() => dismissAsk($, q.id, w.dismiss)}>{w.dismiss}</Button>
        </Box>
        {typing && 'Input' in ui && (
          <ui.Input key={`in${q.id}`} autoFocus placeholder={w.disagree} submitLabel={w.send} onSubmit={(v: string) => {
            if (v.trim()) void answerAsk($, q.id, v.trim(), w.yourCall, `chief：问题 #${q.id} 的回答：${v.trim()}`)
          }} />
        )}
      </Box>
    )
  }

  // 定过的、撤掉的：缩成一行。你刚定的两分钟内能撤回。
  const closedRow = (q: AskRow) => (
    <Box key={`c${q.id}`} flexDirection="row" gap="sm" alignItems="center" marginTop="xs">
      <Box flexShrink={1}>
        <Text size="footnote" dimColor wrap="truncate-end">
          {q.status === 'withdrawn' ? `${short(splitAsk(q.question).ask, 30)} · ${w.withdrawn(q.reason ?? '')}` : `✓ ${short(splitAsk(q.question).ask, 30)} · ${q.status === 'dismissed' ? w.dismissed : w.decided(short(q.answer ?? '', 40))}`}
        </Text>
      </Box>
      {q.status !== 'withdrawn' && <Button key={`re${q.id}`} plain onPress={() => reopenAsk($, q.id, w.reopen)}>{w.reopen}</Button>}
    </Box>
  )

  // ── 一件事一张卡：标题、截止、去会话；会话在等你点的最前，然后问题、回复 ──
  const card = (c: Card) => {
    const th = c.thing
    const title = th ? th.title : c.replies[0] ? whatOf(c.replies[0]) : c.sending[0] ? whatOf(c.sending[0]) : w.ask
    const due = th?.due === undefined ? undefined : dueLabel(th.due)
    const ready = c.asks.filter(q => q.suggest !== '')
    const id = th ? `card${th.id}` : `card-${c.key}`
    return (
      <Box key={id} flexDirection="column" borderStyle="round" borderColor={c.rank <= 1 ? 'error' : 'inactive'} paddingX="md" paddingY="sm" gap="xs" marginTop="sm">
        <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap="sm">
          <Box flexShrink={1}><Text weight="semibold" wrap="wrap">{title}</Text></Box>
          <Box flexDirection="row" gap="sm" alignItems="center">
            {due && <Text size="caption" color={due.color} dimColor={due.color === undefined}>{due.text}</Text>}
            {c.session && !c.waiting && <Button key={`oa-${c.key}`} plain onPress={() => openSession($, c.session ?? '', title)}>{w.goSession}</Button>}
          </Box>
        </Box>
        {c.asks.length > 1 && <Text size="caption" color="warning">{w.pending(c.asks.length)}</Text>}
        {c.waiting && (
          <Box flexDirection="column" gap="xs">
            <Text wrap="wrap"><Text color="error" weight="semibold">{w.waiting}{t().colon}</Text>{c.waiting}</Text>
            <Box flexDirection="row"><Button key={`go-${c.key}`} variant="primary" onPress={() => openSession($, c.session ?? '', title)}>{w.goPoint}</Button></Box>
          </Box>
        )}
        {c.asks.map(q => askRow(q, c.asks.length > 1 && Date.parse(q.at) - Date.parse(c.asks[0].at) > 60_000))}
        {c.replies.map(r => replyCard($, ui, s, edit, opened, r))}
        {c.sending.map(r => sendingRow($, ui, r))}
        {c.closed.map(closedRow)}
        {ready.length > 1 && (
          <Box flexDirection="row" marginTop="xs">
            <Button key={`all-${c.key}`} onPress={() => answerAll($, ready.map(q => q.id), w.allOk)}>{w.allOk}</Button>
          </Box>
        )}
      </Box>
    )
  }

  const empty = box.system.length === 0 && box.cards.length === 0
  return (
    <Box flexDirection="column" marginTop="sm">
      {box.system.length > 0 && (
        <Box flexDirection="column" borderStyle="round" borderColor={box.system.some(x => x.kind === 'key' || x.kind === 'corrupt' || x.kind === 'engine' || x.kind === 'source') ? 'error' : 'suggestion'} paddingX="md" paddingY="sm" gap="xs">
          {box.system.map(sysRow)}
        </Box>
      )}
      {empty && <Box marginTop="sm"><Text color="success">{w.clear}</Text></Box>}
      {box.cards.map(card)}
      {box.withdrawn.length > 0 && (
        <Box flexDirection="column" marginTop="sm">
          <Text size="caption" dimColor>{w.withdrawnToday}</Text>
          {box.withdrawn.map(q => <Text key={`wd${q.id}`} size="footnote" dimColor wrap="truncate-end">{s.things.find(x => x.id === q.thing)?.title ?? w.ask} · {short(splitAsk(q.question).ask, 30)} · {w.withdrawn(q.reason ?? '')}</Text>)}
        </Box>
      )}
      <Box marginTop="md">
        <Text size="caption" dimColor wrap="wrap">{w.today(today.length, count('forwarded', 'opened'), count('noted', 'asked'), count('ignored'), sentToday)}</Text>
      </Box>
    </Box>
  )
}

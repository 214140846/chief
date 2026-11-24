// 「现在要你」页：今天替你办了多少、要你定的事、等你确认的回复、要盯一下的事情。
import type { EngineInterface as Engine } from 'claude-code'

import type { AskRow, DecisionRow, Snapshot } from '../../types'
import { answerAll, answerAsk, dismissAsk, openSession, reopenAsk, setTab, toggle } from '../actions'
import { awake, daysLeft, dueLabel, listify, md, replyGist, short, snoozed, splitAsk, startOfToday, type Els } from '../ui'
import { t } from '../i18n'
import { replyCard } from './outbox'

export function nowTab($: Engine, ui: Els, s: Snapshot, opened: string[] = [], edit: Record<string, string> = {}) {
  const { Box, Text, Button } = ui
  const w = t().now
  const dayStart = startOfToday()
  const today = s.decisions.filter(d => Date.parse(d.at) >= dayStart)
  const count = (...v: DecisionRow['verdict'][]) => today.filter(d => v.includes(d.verdict)).length
  const sentToday = s.replies.filter(r => r.status === 'sent' && r.sentAt !== undefined && Date.parse(r.sentAt) >= dayStart).length
  // 要你定的按事情合成一张卡：一件事一张，里面每个问题各自回。稍后再说的事情：它的问题也先收起。
  const cards = askCards(s, Date.now())
  const shown = new Set(cards.map(c => c.thing))
  const withdrawnElse = s.asks.filter(a => a.status === 'withdrawn' && a.closedAt !== undefined && Date.parse(a.closedAt) >= dayStart && !shown.has(a.thing))
  const toSend = s.replies.filter(r => r.status === 'pending' || r.status === 'failed').length
  const thingOf = (id: number) => s.things.find(t => t.id === id)
  const dueSoon = s.things.filter(t => awake(t) && t.due !== undefined && daysLeft(t.due) <= 3).sort((a, b) => (a.due ?? '').localeCompare(b.due ?? ''))
  const blocked = s.things.filter(t => awake(t) && t.blocker !== undefined)

  // 一个问题：背景淡一点，要你定的加粗，建议单独框起来；照办、不同意（点开才有输入框）、不用问了。
  const askRow = (q: AskRow, fresh: boolean) => {
    const linked = q.reply === undefined ? undefined : s.replies.find(r => r.id === q.reply)
    const { context, ask } = splitAsk(q.question)
    // 旧的问题里可能还列着好几问：listify 拆出来的第一段是引子（加粗），后面是编号列表。
    const whole = listify(ask)
    const gap = whole.indexOf('\n\n')
    const listed = whole === ask ? [ask] : gap < 0 ? ['', whole] : [whole.slice(0, gap), whole.slice(gap + 2)]
    const typing = opened.includes(`dis${q.id}`)
    return (
      <Box key={`q${q.id}`} flexDirection="column" gap="xs" marginTop="xs">
        {context !== '' && <Text size="footnote" dimColor wrap="wrap">{context}</Text>}
        {listed[0] !== '' && <Text weight="semibold" wrap="wrap">{fresh && <Text color="warning">{w.fresh} </Text>}{listed[0]}</Text>}
        {listed.length > 1 && md(ui, listed[1])}
        {q.suggest !== '' && (
          <Box flexDirection="column" borderStyle="round" borderColor="inactive" paddingX="md" paddingY="xs">
            <Text dimColor size="caption">{w.suggest}</Text>
            {md(ui, listify(q.suggest))}
          </Box>
        )}
        {linked && <Text size="footnote" dimColor wrap="wrap">{w.linked(replyGist(linked))}</Text>}
        <Box flexDirection="row" gap="sm">
          {q.suggest !== '' && (
            <Button key={`ok${q.id}`} variant="primary" onPress={() => answerAsk($, q.id, '照建议办', w.ok, `chief：问题 #${q.id} 照建议办`)}>{w.ok}</Button>
          )}
          <Button key={`no${q.id}`} onPress={() => toggle($, `dis${q.id}`)}>{w.disagreeShort}</Button>
          <Button key={`dm${q.id}`} onPress={() => dismissAsk($, q.id, w.dismiss)}>{w.dismiss}</Button>
        </Box>
        {typing && 'Input' in ui && (
          <ui.Input key={`in${q.id}`} placeholder={w.disagree} submitLabel={w.send} onSubmit={(v: string) => {
            if (v.trim()) void answerAsk($, q.id, v.trim(), w.yourCall, `chief：问题 #${q.id} 的回答：${v.trim()}`)
          }} />
        )}
      </Box>
    )
  }

  // 定过的、撤掉的：缩成一行。你刚定的两分钟内能撤回。
  const closedRow = (q: AskRow) => (
    <Box key={`c${q.id}`} flexDirection="row" gap="sm" alignItems="center" marginTop="xs">
      <Text size="footnote" dimColor wrap="wrap">
        {q.status === 'withdrawn' ? w.withdrawn(q.reason ?? '') : `✓ ${short(splitAsk(q.question).ask, 30)} · ${q.status === 'dismissed' ? w.dismissed : w.decided(short(q.answer ?? '', 40))}`}
      </Text>
      {q.status !== 'withdrawn' && <Button key={`re${q.id}`} onPress={() => reopenAsk($, q.id, w.reopen)}>{w.reopen}</Button>}
    </Box>
  )

  const card = (c: AskCard) => {
    const t = thingOf(c.thing)
    const ready = c.open.filter(q => q.suggest !== '')
    const due = t?.due === undefined ? undefined : dueLabel(t.due)
    return (
      <Box key={`card${c.thing}`} flexDirection="column" borderStyle="round" borderColor="inactive" paddingX="md" paddingY="sm" gap="xs" marginTop="sm">
        <Box flexDirection="row" alignItems="center" gap="xs">
          <Text dimColor size="caption">{t ? t.title : w.ask}</Text>
          {due && <Text size="caption" color={due.color}>· {due.text}</Text>}
          {c.open.length > 1 && <Text size="caption" color="warning">· {w.pending(c.open.length)}</Text>}
        </Box>
        {c.open.map(q => askRow(q, c.open.length > 1 && Date.parse(q.at) - Date.parse(c.open[0].at) > 60_000))}
        {c.closed.map(closedRow)}
        {(ready.length > 1 || t?.session) && (
          <Box flexDirection="row" gap="sm" marginTop="xs">
            {ready.length > 1 && <Button key={`all${c.thing}`} onPress={() => answerAll($, ready.map(q => q.id), w.allOk)}>{w.allOk}</Button>}
            {t?.session && <Button key={`oa${c.thing}`} onPress={() => openSession($, t.session ?? '', t.title)}>{w.details}</Button>}
          </Box>
        )}
      </Box>
    )
  }

  return (
    <Box flexDirection="column" marginTop="sm">
      <Text dimColor wrap="wrap">
        {w.today(today.length, count('forwarded', 'opened'), count('noted', 'asked'), count('ignored'), sentToday)}
      </Text>
      {cards.length === 0 && toSend === 0 ? <Box marginTop="sm"><Text color="success">{w.clear}</Text></Box> : cards.map(card)}
      {withdrawnElse.length > 0 && (
        <Box flexDirection="column" marginTop="sm">
          <Text size="caption" dimColor>{w.withdrawnToday}</Text>
          {withdrawnElse.map(q => <Text key={`wd${q.id}`} size="footnote" dimColor wrap="wrap">{thingOf(q.thing)?.title ?? w.ask} · {short(splitAsk(q.question).ask, 30)} · {w.withdrawn(q.reason ?? '')}</Text>)}
        </Box>
      )}
      {toSend > 0 && (
        <Box flexDirection="column" marginTop="md">
          <Text size="footnote" weight="semibold">{w.toConfirm(toSend)}</Text>
          {s.replies.filter(r => r.status === 'pending' || r.status === 'failed').map(r => replyCard($, ui, s, edit, opened, r))}
        </Box>
      )}
      {(dueSoon.length > 0 || blocked.length > 0) && (
        <Box flexDirection="column" marginTop="md" gap="xs">
          <Text weight="semibold">{w.watch}</Text>
          {dueSoon.map(t => {
            const d = dueLabel(t.due!)
            return <Text key={`ds${t.id}`} wrap="wrap"><Text color={d.color}>{d.text}</Text> · {t.title}{t.progress ? <Text dimColor> · {short(t.progress, 40)}</Text> : ''}</Text>
          })}
          {blocked.filter(t => !dueSoon.includes(t)).map(t => (
            <Text key={`bk${t.id}`} wrap="wrap"><Text color="error">{w.blocked}</Text> · {t.title} <Text dimColor>· {short(t.blocker ?? '', 60)}</Text></Text>
          ))}
          <Button key="go-things" onPress={() => setTab($, 'things')}>{w.allThings}</Button>
        </Box>
      )}
    </Box>
  )
}

export type AskCard = { thing: number; open: AskRow[]; closed: AskRow[] }

const REOPEN_MS = 120_000

// 要你定的卡：按事情归，一件事一张。还有开着的问题、或你刚定的（两分钟内能撤回）才出卡；
// 卡上也列今天撤掉的问题（灰字说为什么）。有截止日的在前、越近越前，其余按最早的问题排。
export function askCards(s: Snapshot, now: number): AskCard[] {
  const dayStart = startOfToday()
  const by = new Map<number, AskCard>()
  const of = (thing: number) => by.get(thing) ?? (by.set(thing, { thing, open: [], closed: [] }), by.get(thing)!)
  const asleep = (thing: number) => s.things.some(t => t.id === thing && snoozed(t))
  for (const a of s.asks) {
    if (asleep(a.thing)) continue
    const closed = a.closedAt === undefined ? NaN : Date.parse(a.closedAt)
    if (a.status === 'open') of(a.thing).open.push(a)
    else if ((a.status === 'answered' || a.status === 'dismissed') && now - closed < REOPEN_MS) of(a.thing).closed.push(a)
  }
  const cards = [...by.values()].filter(c => c.open.length > 0 || c.closed.length > 0)
  for (const c of cards) {
    c.open.sort((a, b) => a.at.localeCompare(b.at))
    c.closed.push(...s.asks.filter(a => a.thing === c.thing && a.status === 'withdrawn' && a.closedAt !== undefined && Date.parse(a.closedAt) >= dayStart))
  }
  const due = (c: AskCard) => s.things.find(t => t.id === c.thing)?.due ?? '9999'
  const first = (c: AskCard) => c.open[0]?.at ?? c.closed[0]?.at ?? ''
  return cards.sort((a, b) => due(a).localeCompare(due(b)) || first(a).localeCompare(first(b)))
}

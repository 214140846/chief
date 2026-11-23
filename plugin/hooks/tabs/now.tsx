// 「现在要你」页：今天替你办了多少、要你定的事、等你确认的回复、要盯一下的事情。
import type { EngineInterface as Engine } from 'claude-code'

import type { AskRow, DecisionRow, Snapshot } from '../../types'
import { answerAsk, openSession, setTab } from '../actions'
import { daysLeft, dueLabel, listify, live, md, replyGist, short, splitAsk, startOfToday, type Els } from '../ui'
import { replyCard } from './outbox'

export function nowTab($: Engine, ui: Els, s: Snapshot, opened: string[] = [], edit: Record<string, string> = {}) {
  const { Box, Text, Button } = ui
  const dayStart = startOfToday()
  const today = s.decisions.filter(d => Date.parse(d.at) >= dayStart)
  const count = (...v: DecisionRow['verdict'][]) => today.filter(d => v.includes(d.verdict)).length
  const sentToday = s.replies.filter(r => r.status === 'sent' && r.sentAt !== undefined && Date.parse(r.sentAt) >= dayStart).length
  const asks = s.asks.filter(a => a.status === 'open')
  const toSend = s.replies.filter(r => r.status === 'pending' || r.status === 'failed').length
  const thingOf = (id: number) => s.things.find(t => t.id === id)
  const dueSoon = s.things.filter(t => live(t) && t.due !== undefined && daysLeft(t.due) <= 3).sort((a, b) => (a.due ?? '').localeCompare(b.due ?? ''))
  const blocked = s.things.filter(t => live(t) && t.blocker !== undefined)

  const askCard = (q: AskRow) => {
    const t = thingOf(q.thing)
    const linked = q.reply === undefined ? undefined : s.replies.find(r => r.id === q.reply)
    const { context, ask } = splitAsk(q.question)
    // listify 拆出来的：第一段是引子（加粗），后面是编号列表；没拆就整句加粗。
    const whole = listify(ask)
    const gap = whole.indexOf('\n\n')
    const listed = whole === ask ? [ask] : gap < 0 ? ['', whole] : [whole.slice(0, gap), whole.slice(gap + 2)]
    return (
      <Box key={`a${q.id}`} flexDirection="column" borderStyle="round" borderColor="inactive" paddingX="md" paddingY="sm" gap="xs" marginTop="sm">
        <Box flexDirection="row" alignItems="center" gap="xs">
          
          {t ? <Text dimColor size="caption">{t.title}</Text> : <Text dimColor size="caption">要你定</Text>}
        </Box>
        {/* 背景淡一点；要你定的加粗，几件事拆成编号；建议单独框起来。 */}
        {context !== '' && <Text size="footnote" dimColor wrap="wrap">{context}</Text>}
        {listed[0] !== '' && <Text weight="semibold" wrap="wrap">{listed[0]}</Text>}
        {listed.length > 1 && md(ui, listed[1])}
        {q.suggest !== '' && (
          <Box flexDirection="column" borderStyle="round" borderColor="inactive" paddingX="md" paddingY="xs">
            <Text dimColor size="caption">建议</Text>
            {md(ui, listify(q.suggest))}
          </Box>
        )}
        {linked && <Text size="footnote" dimColor wrap="wrap">相关的待发出：{replyGist(linked)}</Text>}
        <Box flexDirection="row" gap="sm">
          {q.suggest !== '' && (
            <Button key={`ok${q.id}`} variant="primary" onPress={() => answerAsk($, q.id, '照建议办', '照建议办', `chief：问题 #${q.id} 照建议办`)}>照建议办</Button>
          )}
          {t?.session && (
            <Button key={`oa${q.id}`} onPress={() => openSession($, t.session ?? '', t.title)}>看细节</Button>
          )}
        </Box>
        {/* 要你定的卡片只给三条路：照建议办、去会话里看、写你的决定。攒着一起发的「批注」只放在进度页。 */}
        {'Input' in ui && (
          <ui.Input key={`in${q.id}`} placeholder="不同意？写你的决定" submitLabel="发送" onSubmit={(v: string) => {
            if (v.trim()) void answerAsk($, q.id, v.trim(), '你的决定', `chief：问题 #${q.id} 的回答：${v.trim()}`)
          }} />
        )}
      </Box>
    )
  }

  return (
    <Box flexDirection="column" marginTop="sm">
      <Text dimColor wrap="wrap">
        今天：判断了 {today.length} 条 · 派人去办 {count('forwarded', 'opened')} · 只记下 {count('noted', 'asked')} · 忽略 {count('ignored')} · 替你发出 {sentToday}
      </Text>
      {asks.length === 0 && toSend === 0 ? <Box marginTop="sm"><Text color="success">没有要你定、要你确认的事。</Text></Box> : asks.map(askCard)}
      {toSend > 0 && (
        <Box flexDirection="column" marginTop="md">
          <Text size="footnote" weight="semibold">等你确认再发 · {toSend}</Text>
          {s.replies.filter(r => r.status === 'pending' || r.status === 'failed').map(r => replyCard($, ui, s, edit, opened, r))}
        </Box>
      )}
      {(dueSoon.length > 0 || blocked.length > 0) && (
        <Box flexDirection="column" marginTop="md" gap="xs">
          <Text weight="semibold">要盯一下的</Text>
          {dueSoon.map(t => {
            const d = dueLabel(t.due!)
            return <Text key={`ds${t.id}`} wrap="wrap"><Text color={d.color}>{d.text}</Text> · {t.title}{t.progress ? <Text dimColor> · {short(t.progress, 40)}</Text> : ''}</Text>
          })}
          {blocked.filter(t => !dueSoon.includes(t)).map(t => (
            <Text key={`bk${t.id}`} wrap="wrap"><Text color="error">卡住</Text> · {t.title} <Text dimColor>· {short(t.blocker ?? '', 60)}</Text></Text>
          ))}
          <Button key="go-things" onPress={() => setTab($, 'things')}>看全部进度</Button>
        </Box>
      )}
    </Box>
  )
}

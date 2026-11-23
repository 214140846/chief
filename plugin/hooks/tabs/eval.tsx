// 「测评」页：替你做了多少、主会话用掉的额度、演练、最近 7 天的判断和准不准。
import type { EngineInterface as Engine } from 'claude-code'

import { expectOf } from '../../engine/src/shared/rules'
import type { DecisionRow, HubUsage, Snapshot } from '../../types'
import { markRight, markWrong, removeCase, runEvals, saveCase, toggle } from '../actions'
import { L, t } from '../i18n'
import { ago, scenarioName, select, short, verdictName, type Els } from '../ui'
import { EVAL_DAYS, MINUTES, chartSvg, statsOf } from '../data'
import { dayOf } from '../usage'

// 上下文超过这么多，每来一条消息都要把它整个读一遍，额度涨得快：提醒换个新主会话。
const LONG_CONTEXT = 300_000

const pts = (n: number) => (n < 0.05 ? t().eval.lessThan : n.toFixed(1))

function resetAt(iso: string | undefined, withDay: boolean): string {
  if (!iso) return ''
  const d = new Date(iso)
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return t().eval.resets(`${withDay ? t().eval.weekday[d.getDay()] : ''}${hm}`)
}

// 主会话用掉的订阅额度（hooks/usage.ts 记的）：今天、最近几天、账号现在的两个窗口、上下文多长。
export function usageBox(ui: Els, u: HubUsage) {
  const { Box, Text } = ui
  const w = t().eval
  const days = Object.entries(u.days).sort(([a], [b]) => b.localeCompare(a))
  const now = u.now
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="inactive" paddingX="md" paddingY="sm" gap="xs" marginTop="sm">
      <Text weight="semibold">{w.usageTitle}</Text>
      {days.length === 0
        ? <Text dimColor wrap="wrap">{w.usageNone}</Text>
        : (
          <Box flexDirection="column" gap="xs">
            {days.slice(0, 7).map(([day, d], i) => (
              <Text key={`ud-${day}`} wrap="wrap" dimColor={i > 0}>
                {w.usageDay(day === dayOf(Date.now()) ? w.today : day.slice(5), pts(d.five), pts(d.week), d.calls)}
              </Text>
            ))}
          </Box>
        )}
      {now && (now.five !== null || now.week !== null) && (
        <Text size="footnote" dimColor wrap="wrap">
          {w.accountNow}{now.five !== null ? w.fiveUsed(now.five, resetAt(now.fiveReset, false)) : ''}{now.five !== null && now.week !== null ? ' · ' : ''}{now.week !== null ? w.weekUsed(now.week, resetAt(now.weekReset, true)) : ''}
        </Text>
      )}
      {now && now.context !== null && (
        <Text size="footnote" color={now.context > LONG_CONTEXT ? 'warning' : undefined} dimColor={now.context <= LONG_CONTEXT} wrap="wrap">
          {w.context(now.context)}
          {now.context > LONG_CONTEXT ? w.contextLong : ''}
        </Text>
      )}
      <Text size="caption" dimColor wrap="wrap">{w.usageHow}</Text>
    </Box>
  )
}

export function evalTab($: Engine, ui: Els, s: Snapshot, opened: string[]) {
  const { Box, Text, Button } = ui
  const w = t().eval
  const st = statsOf(s)
  const accuracy = st.reviewed === 0 ? w.notReviewed : w.accuracy(Math.round(((st.reviewed - st.wrong) / st.reviewed) * 100), st.reviewed, st.wrong)
  const sentByYou = st.replies.asIs + st.replies.edited
  const recent = [...s.decisions].reverse().slice(0, 30)

  const decisionRow = (d: DecisionRow) => {
    const key = `d${d.event}`
    const r = s.reviews[String(d.event)]
    const isOpen = opened.includes(key)
    return (
      <Box key={key} flexDirection="column" marginTop="xs" gap="xs">
        <Box flexDirection="row" alignItems="center" gap="xs">
        
        <Button key={`dt${d.event}`} plain onPress={() => toggle($, key)}>
          {isOpen ? '▾ ' : '▸ '}{verdictName(d.verdict)} <Text dimColor>· {scenarioName(d.scenario)} · {ago(d.at)}</Text>
          {r ? (r.ok ? ' ✓' : ' ✗') : ''}
        </Button>
        </Box>
        <Box paddingLeft="md" flexDirection="column">
          {d.what && <Text dimColor wrap="truncate-end">{d.what.from ? `${d.what.from}${t().colon}` : ''}{short(d.what.text, 80)}</Text>}
          <Text wrap="wrap">{short(d.reason, isOpen ? 300 : 80)}</Text>
          {r && !r.ok && r.note && <Text color="error" size="caption" wrap="wrap">{w.youSaid(r.note)}</Text>}
        </Box>
        {isOpen && !r && (
          <Box flexDirection="column" paddingLeft="md" gap="xs">
            <Box flexDirection="row" gap="sm">
              <Button key={`ok-${d.event}`} onPress={() => markRight($, d.event)}>{w.right}</Button>
            </Box>
            {'Input' in ui && (
              <ui.Input key={`wr-${d.event}`} placeholder={w.wrongPlaceholder} submitLabel={w.wrong} onSubmit={(v: string) => {
                if (v.trim()) void markWrong($, d.event, v.trim())
              }} />
            )}
          </Box>
        )}
        {isOpen && (
          <Box flexDirection="row" gap="sm" alignItems="center" paddingLeft="md">
            <Text size="caption" dimColor>{w.saveAs}</Text>
            {select(ui, `sc-${d.event}`, r && !r.ok ? '' : expectOf(d.verdict), Object.entries(L().expect).map(([value, label]) => ({ value, label })), val => { if (val) void saveCase($, d.event, val) })}
          </Box>
        )}
      </Box>
    )
  }

  const v = st.value
  const hours = v.minutes >= 60 ? w.hours((v.minutes / 60).toFixed(1)) : w.minutes(v.minutes)
  const EXPECT: Record<string, string> = L().expect
  const kind = expectOf
  const lastRun = s.evals.runs.at(-1)
  const results = lastRun ? s.evals.cases.filter(c => lastRun.events[c.id] !== undefined).map(c => {
    const d = [...s.dryDecisions].reverse().find(x => x.event === lastRun.events[c.id])
    return { c, d, ok: d ? kind(d.verdict) === c.expect : null }
  }) : []
  const judged = results.filter(r => r.ok !== null)

  return (
    <Box flexDirection="column" marginTop="sm" gap="xs">
      <Box flexDirection="column" borderStyle="round" borderColor="success" paddingX="md" paddingY="sm" gap="xs">
        <Text weight="semibold">{w.didTitle(EVAL_DAYS)}</Text>
        <Text size="heading" weight="semibold" color="success">{w.saved(hours)}</Text>
        <Text wrap="wrap">
          {w.did(v)}
        </Text>
        <Text size="caption" dimColor wrap="wrap">
          {w.estimate(MINUTES)}
        </Text>
      </Box>

      {usageBox(ui, s.hubUsage)}

      <Box flexDirection="column" borderStyle="round" borderColor="inactive" paddingX="md" paddingY="sm" gap="xs" marginTop="sm">
        <Box flexDirection="row" justifyContent="space-between" alignItems="center">
          <Text weight="semibold">{w.drill(s.evals.cases.length)}</Text>
          {s.evals.cases.length > 0 && <Button key="run-evals" variant="primary" onPress={() => runEvals($)}>{w.runDrill}</Button>}
        </Box>
        <Text size="caption" dimColor wrap="wrap">{w.drillHelp}</Text>
        {lastRun && (
          <Text>{w.lastRun(ago(lastRun.at), judged.length < results.length ? w.running(judged.length, results.length) : w.score(judged.filter(r => r.ok).length, results.length))}</Text>
        )}
        {results.map(({ c, d, ok }) => (
          <Box key={`ev-${c.id}`} flexDirection="column" paddingY="xs">
            <Box flexDirection="row" gap="sm" alignItems="flex-start">
              <Text color={ok === null ? undefined : ok ? 'success' : 'error'}>{ok === null ? '…' : ok ? '✓' : '✗'}</Text>
              <Box flexGrow={1} flexShrink={1}><Text size="footnote" wrap="truncate-end">{c.from}{t().colon}{c.text}</Text></Box>
              <Button key={`rmcase-${c.id}`} plain onPress={() => removeCase($, c.id)}>{w.removeCase}</Button>
            </Box>
            <Box paddingLeft="md" flexDirection="column">
              <Text size="caption" dimColor>{w.should(EXPECT[c.expect] ?? c.expect)}{d ? w.it(EXPECT[kind(d.verdict)] ?? '') : ''}</Text>
              {d && ok === false && <Text size="caption" color="error" wrap="wrap">{w.itsReason(d.reason)}</Text>}
            </Box>
          </Box>
        ))}
      </Box>

      <Box marginTop="md"><Text weight="semibold">{w.lastDays(EVAL_DAYS)}</Text></Box>
      <Text wrap="wrap">
        {w.judged(st.judged, (st.byVerdict.forwarded ?? 0) + (st.byVerdict.opened ?? 0), st.byVerdict.noted ?? 0, st.byVerdict.ignored ?? 0, st.byVerdict.asked ?? 0)}
      </Text>
      <Text>{w.interrupts(st.asks)}</Text>
      <Text>{w.accuracyLine(accuracy)}</Text>
      <Text wrap="wrap">
        {w.replies(st.replies)}
      </Text>
      {sentByYou > 0 && <Text dimColor size="caption">{w.asIsRate(Math.round((st.replies.asIs / sentByYou) * 100))}</Text>}
      {'Svg' in ui && st.judged > 0 && (
        <Box flexDirection="column" marginTop="sm">
          <ui.Svg source={chartSvg(st.days)} alt={st.days.map(d => w.chartAlt(d.label, d.judged, d.dispatched, d.asks)).join(w.chartSep)} />
          <Text dimColor size="caption">{w.legend}</Text>
        </Box>
      )}

      <Box marginTop="md"><Text weight="semibold">{w.log}</Text></Box>
      {recent.length === 0 && <Text dimColor>{w.noLog}</Text>}
      {recent.map(decisionRow)}
    </Box>
  )
}

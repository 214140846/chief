// 「进度」页：每件事做到哪了、下一步、卡在哪、结果、截止；稍后再说的、最近做的（能撤回）、搜以前的事。
import type { EngineInterface as Engine, RenderChildren } from 'claude-code'

import type { SearchHit, Snapshot, ThingRow } from '../../types'
import { clearSearch, finish, openSession, search, snooze, tell, toggle, undo, wake } from '../actions'
import { t as dict } from '../i18n'
import { ago, annotateBox, annotateButton, awake, daysLeft, gist, live, md, short, snoozed, startOfToday, wakeLabel, type Els } from '../ui'

// 稍后再说的几个快捷选项：until 是 chief thing snooze 认的写法。
// 名字在 i18n.ts 的 things.later / laterSay 里。
const LATER = [
  { key: '2h', until: '2h' },
  { key: 'tm', until: 'tomorrow 09:00' },
  { key: 'mon', until: 'next monday 09:00' },
] as const

// 搜出来的链接只认普通的网址，再放进 Markdown。
const SAFE_URL = /^https?:\/\/[^\s()<>[\]]+$/

export function thingsTab($: Engine, ui: Els, s: Snapshot, opened: string[], found: { q: string; hits: SearchHit[]; error?: string } | null = null) {
  const { Box, Text, Button } = ui
  const T = dict()
  const w = T.things
  const dayStart = startOfToday()
  // 稍后再说的不算在做：收在下面「稍后再说」里。
  const active = s.things.filter(awake)
  const later = s.things.filter(snoozed).sort((a, b) => (a.snooze?.until ?? '').localeCompare(b.snooze?.until ?? ''))
  const laterOpen = opened.includes('later-list')
  const recent = s.undo.slice(0, 15)
  const recentOpen = opened.includes('undo-list')
  const act = (t: ThingRow) => (t.session ? s.activity[t.session] : undefined)
  // 最后有动静的时间：chief 记的进展，和会话里你自己推进的，取晚的那个。
  const touched = (t: ThingRow) => {
    const a = act(t)?.at
    return a && a > t.updatedAt ? a : t.updatedAt
  }
  const staleDays = (t: ThingRow) => Math.floor((Date.now() - Date.parse(touched(t))) / 86_400_000)
  // 会话里最新说的话（它说话的时间比 chief 记的进展新时才算「最新」；收到消息不算说话）。
  const live_ = (t: ThingRow) => {
    const a = act(t)
    const said = a?.saidAt ?? a?.at
    return a && a.last && said && said > t.updatedAt ? { ...a, at: said } : null
  }
  // 「最近」：chief 记的进展和会话最新说的话，取新的那个，带上时间。每张卡都有这一行。
  const latest = (t: ThingRow): { when: string; text: string; fromSession: boolean } => {
    const f = live_(t)
    if (f) return { when: ago(f.at), text: gist(f.last, 90), fromSession: true }
    return { when: ago(t.updatedAt), text: t.progress || w.noReport, fromSession: false }
  }
  // 会话是「跳过权限」模式而主会话不是：主会话发过去的消息会被扣住。
  const bypass = (t: ThingRow) => {
    const m = act(t)?.permissionMode
    return m !== undefined && m !== null && s.hubMode !== null && (m === 'bypassPermissions') !== (s.hubMode === 'bypassPermissions')
  }

  // 为什么要关注这件事（没有就是正常推进）。rank 小的更急。
  type Risk = { rank: number; label: string; color: 'error' | 'warning' }
  const risk = (t: ThingRow): Risk | null => {
    // 会话停在问你的对话框上：最急，它什么都做不了，就等你。
    if (act(t)?.waiting) return { rank: -1, label: w.sessionWaiting, color: 'error' }
    if (t.due !== undefined) {
      const n = daysLeft(t.due)
      if (n < 0) return { rank: 0, label: w.overdue(-n), color: 'error' }
      if (n === 0) return { rank: 1, label: w.dueToday, color: 'error' }
      if (n === 1) return { rank: 2, label: w.dueTomorrow, color: 'warning' }
      if (n === 2) return { rank: 3, label: w.dueAfter, color: 'warning' }
    }
    if (t.blocker) return { rank: 4, label: w.blocked, color: 'error' }
    if (t.status === 'waiting_you') return { rank: 5, label: w.waitingYou, color: 'warning' }
    if (staleDays(t) >= 3) return { rank: 6, label: w.stale(staleDays(t)), color: 'warning' }
    return null
  }
  const attention: { t: ThingRow; r: Risk }[] = []
  for (const t of active) {
    const r = risk(t)
    if (r) attention.push({ t, r })
  }
  attention.sort((a, b) => a.r.rank - b.r.rank)
  const moving = active.filter(t => risk(t) === null).sort((a, b) => touched(b).localeCompare(touched(a)))
  const done = s.things.filter(t => !live(t) && Date.parse(t.updatedAt) >= dayStart - 6 * 86_400_000).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  const doneOpen = opened.includes('done-list')

  // 最上面一句话：现在最要紧的是什么。
  const top = attention[0]
  const headline = top
    ? w.headline(short(top.t.title, 34), top.r.label, top.t.blocker ? short(top.t.blocker, 24) : undefined, top.t.next ? short(top.t.next, 24) : undefined)
    : active.length > 0 ? w.allFine(active.length) : w.none

  const goSession = (t: ThingRow) => openSession($, t.session ?? '', t.title)

  // 稍后再说：点开给三个快捷选项。
  const laterButton = (t: ThingRow) => <Button key={`sn${t.id}`} onPress={() => toggle($, `sn-${t.id}`)}>{w.laterButton}</Button>
  const laterChoices = (t: ThingRow) => opened.includes(`sn-${t.id}`) && (
    <Box flexDirection="row" gap="sm" flexWrap="wrap" alignItems="center">
      <Text size="footnote" dimColor>{w.laterWhen}</Text>
      {LATER.map(c => (
        <Button key={`sn${c.key}-${t.id}`} onPress={() => { void toggle($, `sn-${t.id}`); void snooze($, t, c.until, w.laterSay[c.key]) }}>{w.later[c.key]}</Button>
      ))}
    </Box>
  )

  // 要关注的：一张卡，原因放最前面，写清还差什么，能直接动手。
  const attentionCard = ({ t, r }: { t: ThingRow; r: Risk }) => (
    <Box key={`at${t.id}`} flexDirection="column" borderStyle="round" borderColor={r.color} paddingX="md" paddingY="sm" gap="xs" marginTop="sm">
      <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap="sm">
        <Text weight="semibold" color={r.color}>{r.label}</Text>
        {t.due && <Text size="caption" dimColor>{w.dueOn(t.due)}</Text>}
      </Box>
      <Text weight="semibold" wrap="wrap">{t.title}</Text>
      {act(t)?.waiting && <Text size="footnote" color="error" wrap="wrap"><Text dimColor>{w.asksYou}</Text>{act(t)!.waiting}</Text>}
      {t.blocker && <Text size="footnote" color="error" wrap="wrap">{w.blockedOn(t.blocker)}</Text>}
      <Text size="footnote" wrap="wrap"><Text dimColor>{w.left}</Text>{t.next ?? <Text dimColor>{w.unclear}</Text>}</Text>
      <Text size="footnote" wrap="truncate-end"><Text dimColor>{w.latest}</Text>{latest(t).text}<Text dimColor>{T.gap}{latest(t).when}{latest(t).fromSession ? w.fromSession : ''}</Text></Text>
      {bypass(t) && <Text size="caption" color="warning" wrap="wrap">{w.bypass}</Text>}
      <Box flexDirection="row" gap="sm" marginTop="xs">
        {t.session && <Button key={`ago${t.id}`} variant="primary" onPress={() => goSession(t)}>{act(t)?.waiting ? w.answer : w.goSession}</Button>}
        {t.session && <Button key={`aask${t.id}`} onPress={() => tell($, `chief：转告事情 #${t.id}：现在进展怎么样？还差什么，能不能按时完成？`, w.askProgress)}>{w.askProgress}</Button>}
        {annotateButton($, ui, `t${t.id}`, opened)}
        <Button key={`adn${t.id}`} onPress={() => finish($, t, 'done')}>{w.done}</Button>
        {laterButton(t)}
      </Box>
      {laterChoices(t)}
      {annotateBox($, ui, `t${t.id}`, `【事情 #${t.id} ${t.title}】`, opened)}
    </Box>
  )

  // 正常推进的：收起时最多三行——标题、下一步（或现在）、会话最新一句；点开才看全文和操作。
  const movingRow = (t: ThingRow) => {
    const key = `t${t.id}`
    const isOpen = opened.includes(key)
    const fresh = live_(t)
    const block = (label: string, body: RenderChildren) => (
      <Box flexDirection="column" gap="xs">
        <Text size="caption" weight="semibold" dimColor>{label}</Text>
        {body}
      </Box>
    )
    return (
      <Box key={key} flexDirection="column" borderStyle="round" borderColor="inactive" paddingX="md" paddingY="sm" gap="xs" marginTop="sm">
        <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap="sm">
          <Button key={`tg${t.id}`} plain onPress={() => toggle($, key)}><Text weight="semibold">{`${isOpen ? '▾' : '▸'} ${short(t.title, 48)}`}</Text></Button>
          {t.due ? <Text size="caption" dimColor>{w.dueOn(t.due)}</Text> : null}
        </Box>
        {!isOpen && (
          <Box flexDirection="column" gap="xs" paddingLeft="md">
            <Text size="footnote" wrap="truncate-end"><Text dimColor>{w.nextLine}</Text>{t.next ?? <Text dimColor>{w.unclear}</Text>}</Text>
            <Text size="footnote" wrap="truncate-end"><Text dimColor>{w.latest}</Text>{latest(t).text}<Text dimColor>{T.gap}{latest(t).when}{latest(t).fromSession ? w.fromSession : ''}</Text></Text>
          </Box>
        )}
        {isOpen && (
          <Box flexDirection="column" gap="md" paddingLeft="md" marginTop="xs">
            {/* 会话自己说的比主会话记的新：会话的话更准，放前面；主会话记的标明是它记的、可能过时。 */}
            {fresh && block(w.sessionSaid(ago(fresh.at)), md(ui, fresh.last))}
            {block(w.next, <Text size="footnote" wrap="wrap">{t.next ?? w.unclear}</Text>)}
            {t.progress && block(fresh ? w.hubNoted(ago(t.updatedAt)) : w.nowLabel, <Text size="footnote" dimColor={fresh !== null} wrap="wrap">{t.progress}</Text>)}
            {(t.results ?? []).length > 0 && block(w.results, <Box flexDirection="column">{(t.results ?? []).map((r, i) => <Box key={`rs${t.id}-${i}`}>{md(ui, r)}</Box>)}</Box>)}
            {bypass(t) && <Text size="caption" color="warning" wrap="wrap">{w.bypass}</Text>}
            <Box flexDirection="row" gap="sm" flexWrap="wrap">
              {t.session && <Button key={`ot${t.id}`} variant="primary" onPress={() => goSession(t)}>{w.goSession}</Button>}
              {annotateButton($, ui, `t${t.id}`, opened)}
              <Button key={`dn${t.id}`} onPress={() => finish($, t, 'done')}>{w.done}</Button>
              <Button key={`dr${t.id}`} onPress={() => finish($, t, 'dropped')}>{w.drop}</Button>
              {laterButton(t)}
            </Box>
            {laterChoices(t)}
            {annotateBox($, ui, `t${t.id}`, `【事情 #${t.id} ${t.title}】`, opened)}
          </Box>
        )}
      </Box>
    )
  }

  // 搜出来的：是什么、哪天、对上的那段；有链接给链接，有会话能跳过去。
  const hitRow = (hit: SearchHit, i: number) => (
    <Box key={`sh${i}`} flexDirection="column">
      <Text size="caption" dimColor wrap="truncate-end">{w.hit[hit.kind]} · {hit.date.slice(0, 10)}{hit.archived ? w.archived : ''} · {short(hit.title, 40)}</Text>
      <Text size="footnote" wrap="wrap">{hit.snippet}</Text>
      {((hit.url && SAFE_URL.test(hit.url)) || hit.session) && (
        <Box flexDirection="row" gap="sm" alignItems="center">
          {hit.url && SAFE_URL.test(hit.url) && md(ui, `[${w.openLink}](${hit.url})`)}
          {hit.session && <Button key={`shs${i}`} plain onPress={() => openSession($, hit.session ?? '', hit.title)}>{w.toSession}</Button>}
        </Box>
      )}
    </Box>
  )

  // 收起来的一段：▸ 标题 · 数量，点开才画内容。
  const fold = (key: string, isOpen: boolean, title: string, body: RenderChildren) => (
    <Box flexDirection="column">
      <Box marginTop="lg" marginBottom="xs">
        <Button key={key} plain onPress={() => toggle($, key)}>{`${isOpen ? '▾' : '▸'} ${title}`}</Button>
      </Box>
      {isOpen && <Box flexDirection="column" borderStyle="round" borderColor="inactive" paddingX="md" paddingY="sm" gap="xs">{body}</Box>}
    </Box>
  )

  const section = (title: string, n: number) => (
    <Box marginTop="lg" marginBottom="xs"><Text size="footnote" weight="semibold">{title} · {n}</Text></Box>
  )

  return (
    <Box flexDirection="column" marginTop="sm">
      <Text size="heading" weight="semibold" wrap="wrap" color={top?.r.color}>{headline}</Text>
      <Box flexDirection="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap="sm" marginTop="xs">
        <Text size="caption" dimColor>{w.summary(active.length, attention.length, done.length)}</Text>
        <Box flexDirection="row" gap="sm">
          <Button key="import" onPress={() => tell($, 'chief：导入现在在做的事', w.import)}>{w.import}</Button>
          <Button key="progress" onPress={() => tell($, 'chief：问一遍各事情的最新进展', w.askProgress)}>{w.askAll}</Button>
        </Box>
      </Box>

      {'Input' in ui && (
        <Box width="100%" marginTop="sm">
          <ui.Input key="search" placeholder={w.searchPlaceholder} submitLabel={w.search}
            onSubmit={(v: string) => { if (v.trim()) void search($, v.trim()) }} />
        </Box>
      )}
      {found && (
        <Box flexDirection="column" borderStyle="round" borderColor="claude" paddingX="md" paddingY="sm" gap="sm" marginTop="sm">
          <Box flexDirection="row" justifyContent="space-between" alignItems="center">
            <Text weight="semibold">{w.found(short(found.q, 20), found.hits.length)}</Text>
            <Button key="search-clear" plain onPress={() => clearSearch($)}>✕</Button>
          </Box>
          {found.error && <Text size="footnote" color="error" wrap="wrap">{w.searchFailed(found.error)}</Text>}
          {!found.error && found.hits.length === 0 && <Text size="footnote" dimColor>{w.notFound}</Text>}
          {found.hits.map(hitRow)}
        </Box>
      )}

      {attention.length > 0 && (
        <Box flexDirection="column">
          {section(w.attention, attention.length)}
          {attention.map(attentionCard)}
        </Box>
      )}

      {moving.length > 0 && (
        <Box flexDirection="column">
          {section(w.moving, moving.length)}
          {moving.map(movingRow)}
        </Box>
      )}

      {done.length > 0 && (
        <Box flexDirection="column">
          <Box marginTop="lg" marginBottom="xs">
            <Button key="done-list" plain onPress={() => toggle($, 'done-list')}>{`${doneOpen ? '▾' : '▸'} ${w.doneList(done.length)}`}</Button>
          </Box>
          {doneOpen && (
            <Box flexDirection="column" borderStyle="round" borderColor="inactive" paddingX="md" paddingY="sm" gap="xs">
              {done.map(t => <Text key={`dd${t.id}`} size="footnote" wrap="truncate-end"><Text color="success">✓ </Text>{t.title}</Text>)}
            </Box>
          )}
        </Box>
      )}

      {later.length > 0 && fold('later-list', laterOpen, w.laterList(later.length), later.map(t => (
        <Box key={`lt${t.id}`} flexDirection="row" justifyContent="space-between" alignItems="center" gap="sm">
          <Box flexGrow={1} flexShrink={1}>
            <Text size="footnote" wrap="truncate-end">{t.title}<Text dimColor>{w.wakeAt(wakeLabel(t.snooze?.until ?? ''))}</Text></Text>
          </Box>
          <Button key={`wk${t.id}`} onPress={() => wake($, t)}>{w.wakeNow}</Button>
        </Box>
      )))}

      {recent.length > 0 && fold('undo-list', recentOpen, w.recent(recent.length), recent.map(x => (
        <Box key={`ul${x.id}`} flexDirection="row" justifyContent="space-between" alignItems="center" gap="sm">
          <Box flexGrow={1} flexShrink={1}>
            <Text size="footnote" wrap="truncate-end" dimColor={x.undone !== undefined}>{x.label}<Text dimColor>{T.gap}{ago(x.at)}</Text></Text>
          </Box>
          {x.undone ? <Text size="caption" dimColor>{w.undone}</Text> : <Button key={`un${x.id}`} onPress={() => undo($, x.id)}>{w.undo}</Button>}
        </Box>
      )))}
    </Box>
  )
}

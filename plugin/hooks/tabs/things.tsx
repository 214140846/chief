// 「进度」页：每件事做到哪了、下一步、卡在哪、结果、截止。
import type { EngineInterface as Engine, RenderChildren } from 'claude-code'

import type { Snapshot, ThingRow } from '../../types'
import { finish, openSession, tell, toggle } from '../actions'
import { ago, annotateBox, annotateButton, daysLeft, gist, live, md, short, startOfToday, type Els } from '../ui'

export function thingsTab($: Engine, ui: Els, s: Snapshot, opened: string[]) {
  const { Box, Text, Button } = ui
  const dayStart = startOfToday()
  const active = s.things.filter(live)
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
    return { when: ago(t.updatedAt), text: t.progress || '还没有汇报', fromSession: false }
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
    if (act(t)?.waiting) return { rank: -1, label: '会话在等你回答', color: 'error' }
    if (t.due !== undefined) {
      const n = daysLeft(t.due)
      if (n < 0) return { rank: 0, label: `过期 ${-n} 天`, color: 'error' }
      if (n === 0) return { rank: 1, label: '今天截止', color: 'error' }
      if (n === 1) return { rank: 2, label: '明天截止', color: 'warning' }
      if (n === 2) return { rank: 3, label: '后天截止', color: 'warning' }
    }
    if (t.blocker) return { rank: 4, label: '卡住了', color: 'error' }
    if (t.status === 'waiting_you') return { rank: 5, label: '等你定', color: 'warning' }
    if (staleDays(t) >= 3) return { rank: 6, label: `${staleDays(t)} 天没动静`, color: 'warning' }
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
    ? `最要紧：${short(top.t.title, 34)} ${top.r.label}${top.t.blocker ? `，卡在${short(top.t.blocker, 24)}` : top.t.next ? `，还差${short(top.t.next, 24)}` : ''}`
    : active.length > 0 ? `${active.length} 件事都在正常推进，没有要你操心的` : '还没有事情'

  const goSession = (t: ThingRow) => openSession($, t.session ?? '', t.title)

  // 要关注的：一张卡，原因放最前面，写清还差什么，能直接动手。
  const attentionCard = ({ t, r }: { t: ThingRow; r: Risk }) => (
    <Box key={`at${t.id}`} flexDirection="column" borderStyle="round" borderColor={r.color} paddingX="md" paddingY="sm" gap="xs" marginTop="sm">
      <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap="sm">
        <Text weight="semibold" color={r.color}>{r.label}</Text>
        {t.due && <Text size="caption" dimColor>{t.due} 截止</Text>}
      </Box>
      <Text weight="semibold" wrap="wrap">{t.title}</Text>
      {act(t)?.waiting && <Text size="footnote" color="error" wrap="wrap"><Text dimColor>它问你　</Text>{act(t)!.waiting}</Text>}
      {t.blocker && <Text size="footnote" color="error" wrap="wrap">卡在：{t.blocker}</Text>}
      <Text size="footnote" wrap="wrap"><Text dimColor>还差　　</Text>{t.next ?? <Text dimColor>还不清楚</Text>}</Text>
      <Text size="footnote" wrap="truncate-end"><Text dimColor>最近　　</Text>{latest(t).text}<Text dimColor>　{latest(t).when}{latest(t).fromSession ? ' · 会话' : ''}</Text></Text>
      {bypass(t) && <Text size="caption" color="warning" wrap="wrap">这个会话和主会话的权限模式不一样，主会话转告过去的消息会被扣住</Text>}
      <Box flexDirection="row" gap="sm" marginTop="xs">
        {t.session && <Button key={`ago${t.id}`} variant="primary" onPress={() => goSession(t)}>{act(t)?.waiting ? '去回答' : '去这个会话'}</Button>}
        {t.session && <Button key={`aask${t.id}`} onPress={() => tell($, `chief：转告事情 #${t.id}：现在进展怎么样？还差什么，能不能按时完成？`, '问进展')}>问进展</Button>}
        {annotateButton($, ui, `t${t.id}`, opened)}
        <Button key={`adn${t.id}`} onPress={() => finish($, t, 'done')}>办完了</Button>
      </Box>
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
          {t.due ? <Text size="caption" dimColor>{t.due} 截止</Text> : null}
        </Box>
        {!isOpen && (
          <Box flexDirection="column" gap="xs" paddingLeft="md">
            <Text size="footnote" wrap="truncate-end"><Text dimColor>下一步　</Text>{t.next ?? <Text dimColor>还不清楚</Text>}</Text>
            <Text size="footnote" wrap="truncate-end"><Text dimColor>最近　　</Text>{latest(t).text}<Text dimColor>　{latest(t).when}{latest(t).fromSession ? ' · 会话' : ''}</Text></Text>
          </Box>
        )}
        {isOpen && (
          <Box flexDirection="column" gap="md" paddingLeft="md" marginTop="xs">
            {/* 会话自己说的比主会话记的新：会话的话更准，放前面；主会话记的标明是它记的、可能过时。 */}
            {fresh && block(`会话自己说的 · ${ago(fresh.at)}（最准）`, md(ui, fresh.last))}
            {block('下一步', <Text size="footnote" wrap="wrap">{t.next ?? '还不清楚'}</Text>)}
            {t.progress && block(fresh ? `主会话记的 · ${ago(t.updatedAt)}（可能过时）` : '现在', <Text size="footnote" dimColor={fresh !== null} wrap="wrap">{t.progress}</Text>)}
            {(t.results ?? []).length > 0 && block('结果', <Box flexDirection="column">{(t.results ?? []).map((r, i) => <Box key={`rs${t.id}-${i}`}>{md(ui, r)}</Box>)}</Box>)}
            {bypass(t) && <Text size="caption" color="warning" wrap="wrap">这个会话和主会话的权限模式不一样，主会话转告过去的消息会被扣住</Text>}
            <Box flexDirection="row" gap="sm" flexWrap="wrap">
              {t.session && <Button key={`ot${t.id}`} variant="primary" onPress={() => goSession(t)}>去这个会话</Button>}
              {annotateButton($, ui, `t${t.id}`, opened)}
              <Button key={`dn${t.id}`} onPress={() => finish($, t, 'done')}>办完了</Button>
              <Button key={`dr${t.id}`} onPress={() => finish($, t, 'dropped')}>不做了</Button>
            </Box>
            {annotateBox($, ui, `t${t.id}`, `【事情 #${t.id} ${t.title}】`, opened)}
          </Box>
        )}
      </Box>
    )
  }

  const section = (title: string, n: number) => (
    <Box marginTop="lg" marginBottom="xs"><Text size="footnote" weight="semibold">{title} · {n}</Text></Box>
  )

  return (
    <Box flexDirection="column" marginTop="sm">
      <Text size="heading" weight="semibold" wrap="wrap" color={top?.r.color}>{headline}</Text>
      <Box flexDirection="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap="sm" marginTop="xs">
        <Text size="caption" dimColor>{active.length} 件在做 · {attention.length} 件要关注 · 最近 7 天办完 {done.length} 件</Text>
        <Box flexDirection="row" gap="sm">
          <Button key="import" onPress={() => tell($, 'chief：导入现在在做的事', '导入')}>导入</Button>
          <Button key="progress" onPress={() => tell($, 'chief：问一遍各事情的最新进展', '问进展')}>问一遍进展</Button>
        </Box>
      </Box>

      {attention.length > 0 && (
        <Box flexDirection="column">
          {section('要关注', attention.length)}
          {attention.map(attentionCard)}
        </Box>
      )}

      {moving.length > 0 && (
        <Box flexDirection="column">
          {section('在推进', moving.length)}
          {moving.map(movingRow)}
        </Box>
      )}

      {done.length > 0 && (
        <Box flexDirection="column">
          <Box marginTop="lg" marginBottom="xs">
            <Button key="done-list" plain onPress={() => toggle($, 'done-list')}>{`${doneOpen ? '▾' : '▸'} 办完了 · ${done.length}（最近 7 天）`}</Button>
          </Box>
          {doneOpen && (
            <Box flexDirection="column" borderStyle="round" borderColor="inactive" paddingX="md" paddingY="sm" gap="xs">
              {done.map(t => <Text key={`dd${t.id}`} size="footnote" wrap="truncate-end"><Text color="success">✓ </Text>{t.title}</Text>)}
            </Box>
          )}
        </Box>
      )}
    </Box>
  )
}

// 「待发出」页：工作会话写好的回复，改了再发、不发、让它重写；发送后 5 秒内能撤回。
import type { EngineInterface as Engine } from 'claude-code'

import { DEFAULT_PLACEMENT, DEFAULT_SIGNATURE, placementOf } from '../../engine/src/shared/rules'
import { sourceLabel } from '../../engine/src/shared/sources'
import type { ReplyRow, Snapshot } from '../../types'
import { act, openImage, openSession, redo, send, setEdit, toggle } from '../actions'
import { md, short, startOfToday, whatOf, type Els } from '../ui'

export function replyCard($: Engine, ui: Els, s: Snapshot, edit: Record<string, string>, opened: string[], r: ReplyRow) {
  const { Box, Text, Button } = ui
  const t = s.things.find(x => x.id === r.thing)
  const approve = r.kind === 'approve'
  const who = r.context.who ?? r.target.to ?? '对方'
  const editKey = `edit-${r.id}`
  const redoKey = `redo-${r.id}`
  const editing = opened.includes(editKey)
  const redoing = opened.includes(redoKey)
  const body = edit[String(r.id)] ?? r.body
  const sign = s.policy?.signature ?? DEFAULT_SIGNATURE
  // 一行说清：哪来的、属于哪件事、发到哪。
  const meta = [
    `${sourceLabel(r.source)} · ${short(r.context.where, 30)}`,
    t ? `事情：${short(t.title, 24)}` : '',
    r.source === 'slack' && !approve ? (r.kind === 'message' ? (r.target.thread_ts ? '' : '新消息') : placementOf(r.target, s.policy?.placement ?? DEFAULT_PLACEMENT) === 'thread' ? '回到 thread' : '直接回在对话里') : '',
  ].filter(Boolean).join(' · ')
  return (
    <Box key={`r${r.id}`} flexDirection="column" borderStyle="round" borderColor={r.status === 'failed' ? 'error' : 'inactive'} paddingX="md" paddingY="sm" gap="sm" marginTop="sm">
      <Box flexDirection="column">
        <Text weight="semibold">{approve ? `approve PR ${r.target.ref ?? ''}` : r.kind === 'message' ? `发给 ${who}` : `回 ${who}`}</Text>
        <Text size="caption" dimColor wrap="wrap">{meta}</Text>
      </Box>

      {r.context.said !== '' && (
        <Box paddingLeft="sm" flexDirection="column">
          <Text size="footnote" dimColor wrap="wrap">{short(r.context.who ?? '对方', 16)}：{short(r.context.said, 160)}</Text>
        </Box>
      )}

      {r.status === 'failed' && <Text color="error" wrap="wrap">没发出去：{r.error ?? '没说为什么'}</Text>}

      {!approve && (editing && 'Input' in ui
        ? (
          <Box width="100%">
            <ui.Input key={`body${r.id}`} rows={8} autoFocus value={body} submitLabel="改好了"
              onInput={(v: string) => void setEdit($, r.id, v)}
              onSubmit={(v: string) => { void setEdit($, r.id, v); void toggle($, editKey) }} />
          </Box>
        )
        : (
          // 按发出去的样子显示：正文上方的署名小字、分行、列表都和 Slack 上一样。
          <Box flexDirection="column" borderStyle="round" borderColor="inactive" paddingX="md" paddingY="sm">
            {sign !== '' && r.source === 'slack' && <Text size="footnote" dimColor>{sign} · confirmed by 你</Text>}
            {md(ui, body.replace(/<@([UW][A-Z0-9]+)>/g, (_, id: string) => `**@${s.people?.[id] ?? id}**`))}
          </Box>
        ))}
      {/* 主会话说你在会话里同意了，插件没核对上你亲口说过：不会自己发，等你点。 */}
      {r.confirmAsk && <Text size="footnote" color="warning" wrap="wrap">主会话说你在会话里同意发这条，但没核对上你最近亲口说过话，所以没发：确认要发就点「发送」。</Text>}
      {/* 附的图：发之前让你看到会跟着发出去哪几张。 */}
      {(r.images ?? []).length > 0 && (
        <Box flexDirection="row" gap="sm" flexWrap="wrap" alignItems="center">
          <Text size="footnote" dimColor>附图 {r.images!.length} 张（正文发完跟着发到同一个地方）：</Text>
          {r.images!.map((i, n) => (
            <Button key={`im${r.id}-${n}`} plain onPress={() => openImage($, i.file)}>{`${i.name}（${Math.max(1, Math.round(i.bytes / 1024))} KB）`}</Button>
          ))}
        </Box>
      )}

      <Box flexDirection="row" gap="sm" flexWrap="wrap" alignItems="center">
        <Button key={`sd${r.id}`} variant="primary" onPress={() => send($, r)}>{r.status === 'failed' ? '重发' : approve ? 'approve' : '发送'}</Button>
        {!approve && <Button key={`ed${r.id}`} onPress={() => toggle($, editKey)}>{editing ? '改好了' : '改稿'}</Button>}
        {!approve && <Button key={`rw${r.id}`} onPress={() => toggle($, redoKey)}>让它重写</Button>}
        <Button key={`dp${r.id}`} onPress={() => act($, approve ? '不 approve' : '不发', ['reply', 'drop', String(r.id)])}>{approve ? '不 approve' : '不发'}</Button>
        {t?.session && <Button key={`or${r.id}`} plain onPress={() => openSession($, t.session ?? '', t.title)}>看细节</Button>}
      </Box>

      {redoing && 'Input' in ui && (
        <Box width="100%">
          <ui.Input key={`rd${r.id}`} autoFocus rows={2} placeholder="哪里不对？比如：太长了、语气太硬、先说结论" submitLabel="让它重写"
            onSubmit={(v: string) => { if (v.trim()) { void redo($, r, v.trim()); void toggle($, redoKey) } }} />
        </Box>
      )}
    </Box>
  )
}

// 发出去的这条是谁让发的：你在面板上点的、你在会话里说的（带你的原话）、还是规矩允许直接发的。
function whoSent(r: ReplyRow): string {
  if (r.by === 'policy') return '按规矩直接发'
  if (r.confirm?.how === 'chat') return `你在会话里说「${short(r.confirm.said ?? '', 20)}」`
  return r.original !== undefined ? '你改过再发' : '你点的发送'
}

export function outboxTab($: Engine, ui: Els, s: Snapshot, edit: Record<string, string>, opened: string[] = []) {
  const { Box, Text, Button } = ui
  const toSend = s.replies.filter(r => r.status === 'pending' || r.status === 'failed')
  const inFlight = s.replies.filter(r => r.status === 'queued' || r.status === 'sending')
  const dayStart = startOfToday()
  const sentToday = s.replies.filter(r => r.status === 'sent' && r.sentAt !== undefined && Date.parse(r.sentAt) >= dayStart).reverse()
  const thingOf = (id: number | undefined) => s.things.find(t => t.id === id)

  const card = (r: ReplyRow) => replyCard($, ui, s, edit, opened, r)

  return (
    <Box flexDirection="column" marginTop="sm">
      {inFlight.map(r => (
        <Box key={`q${r.id}`} flexDirection="row" gap="sm" alignItems="center">
          <Text color="suggestion">{r.status === 'sending' ? '正在发' : '马上发出'}：{whatOf(r)}{r.kind === 'approve' ? '' : `「${short(r.body, 30)}」`}</Text>
          {r.status === 'queued' && <Button key={`ud${r.id}`} onPress={() => act($, '撤回', ['reply', 'undo', String(r.id)])}>撤回</Button>}
        </Box>
      ))}
      {toSend.length === 0 && inFlight.length === 0 && <Text color="success">没有等你确认的回复。</Text>}
      {toSend.map(card)}
      {sentToday.length > 0 && <Box marginTop="md"><Text weight="semibold">今天发出的（{sentToday.length}）</Text></Box>}
      {sentToday.slice(0, 10).map(r => (
        <Text key={`st${r.id}`} dimColor wrap="truncate-end">
          {whoSent(r)} · {whatOf(r)}{r.kind === 'approve' ? '' : `：${short(r.body, 60)}`}
        </Text>
      ))}
    </Box>
  )
}

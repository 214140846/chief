// 「待发出」页：工作会话写好的回复，改了再发、不发、让它重写；发送后 5 秒内能撤回。
import type { EngineInterface as Engine } from 'claude-code'

import { DEFAULT_PLACEMENT, DEFAULT_SIGNATURE, placementOf } from '../../engine/src/shared/rules'
import type { ReplyRow, Snapshot } from '../../types'
import { act, openImage, openSession, redo, send, setEdit, toggle } from '../actions'
import { sourceName, t } from '../i18n'
import { md, short, startOfToday, whatOf, type Els } from '../ui'

export function replyCard($: Engine, ui: Els, s: Snapshot, edit: Record<string, string>, opened: string[], r: ReplyRow) {
  const { Box, Text, Button } = ui
  const w = t().outbox
  const th = s.things.find(x => x.id === r.thing)
  const approve = r.kind === 'approve'
  const who = r.context.who ?? r.target.to ?? w.them
  const editKey = `edit-${r.id}`
  const redoKey = `redo-${r.id}`
  const editing = opened.includes(editKey)
  const redoing = opened.includes(redoKey)
  const body = edit[String(r.id)] ?? r.body
  const sign = s.policy?.signature ?? DEFAULT_SIGNATURE
  // 一行说清：哪来的、属于哪件事、发到哪。
  const meta = [
    `${sourceName(r.source)} · ${short(r.context.where, 30)}`,
    th ? w.thing(short(th.title, 24)) : '',
    r.source === 'slack' && !approve ? (r.kind === 'message' ? (r.target.thread_ts ? '' : w.newMessage) : placementOf(r.target, s.policy?.placement ?? DEFAULT_PLACEMENT) === 'thread' ? w.toThread : w.inline) : '',
  ].filter(Boolean).join(' · ')
  return (
    <Box key={`r${r.id}`} flexDirection="column" borderStyle="round" borderColor={r.status === 'failed' ? 'error' : 'inactive'} paddingX="md" paddingY="sm" gap="sm" marginTop="sm">
      <Box flexDirection="column">
        <Text weight="semibold">{approve ? t().reply.approve(r.target.ref ?? '') : r.kind === 'message' ? t().reply.message(who) : t().reply.reply(who)}</Text>
        <Text size="caption" dimColor wrap="wrap">{meta}</Text>
      </Box>

      {r.context.said !== '' && (
        <Box paddingLeft="sm" flexDirection="column">
          <Text size="footnote" dimColor wrap="wrap">{short(r.context.who ?? w.them, 16)}{t().colon}{short(r.context.said, 160)}</Text>
        </Box>
      )}

      {r.status === 'failed' && <Text color="error" wrap="wrap">{w.notSent(r.error ?? t().noReason)}</Text>}

      {!approve && (editing && 'Input' in ui
        ? (
          <Box width="100%">
            <ui.Input key={`body${r.id}`} rows={8} autoFocus value={body} submitLabel={w.doneEditing}
              onInput={(v: string) => void setEdit($, r.id, v)}
              onSubmit={(v: string) => { void setEdit($, r.id, v); void toggle($, editKey) }} />
          </Box>
        )
        : (
          // 按发出去的样子显示：正文上方的署名小字、分行、列表都和 Slack 上一样。
          <Box flexDirection="column" borderStyle="round" borderColor="inactive" paddingX="md" paddingY="sm">
            {sign !== '' && r.source === 'slack' && <Text size="footnote" dimColor>{w.confirmedBy(sign)}</Text>}
            {md(ui, body.replace(/<@([UW][A-Z0-9]+)>/g, (_, id: string) => `**@${s.people?.[id] ?? id}**`))}
          </Box>
        ))}
      {/* 主会话说你在会话里同意了，插件没核对上你亲口说过：不会自己发，等你点。 */}
      {r.confirmAsk && <Text size="footnote" color="warning" wrap="wrap">{w.confirmAsk}</Text>}
      {/* 附的图：发之前让你看到会跟着发出去哪几张。 */}
      {(r.images ?? []).length > 0 && (
        <Box flexDirection="row" gap="sm" flexWrap="wrap" alignItems="center">
          <Text size="footnote" dimColor>{w.images(r.images!.length)}</Text>
          {r.images!.map((i, n) => (
            <Button key={`im${r.id}-${n}`} plain onPress={() => openImage($, i.file)}>{w.image(i.name, Math.max(1, Math.round(i.bytes / 1024)))}</Button>
          ))}
        </Box>
      )}

      <Box flexDirection="row" gap="sm" flexWrap="wrap" alignItems="center">
        <Button key={`sd${r.id}`} variant="primary" onPress={() => send($, r)}>{r.status === 'failed' ? w.resend : approve ? w.approve : w.send}</Button>
        {!approve && <Button key={`ed${r.id}`} onPress={() => toggle($, editKey)}>{editing ? w.doneEditing : w.edit}</Button>}
        {!approve && <Button key={`rw${r.id}`} onPress={() => toggle($, redoKey)}>{w.redo}</Button>}
        <Button key={`dp${r.id}`} onPress={() => act($, approve ? w.noApprove : w.drop, ['reply', 'drop', String(r.id)])}>{approve ? w.noApprove : w.drop}</Button>
        {th?.session && <Button key={`or${r.id}`} plain onPress={() => openSession($, th.session ?? '', th.title)}>{w.details}</Button>}
      </Box>

      {redoing && 'Input' in ui && (
        <Box width="100%">
          <ui.Input key={`rd${r.id}`} autoFocus rows={2} placeholder={w.redoPlaceholder} submitLabel={w.redo}
            onSubmit={(v: string) => { if (v.trim()) { void redo($, r, v.trim()); void toggle($, redoKey) } }} />
        </Box>
      )}
    </Box>
  )
}

// 发出去的这条是谁让发的：你在面板上点的、你在会话里说的（带你的原话）、还是规矩允许直接发的。
function whoSent(r: ReplyRow): string {
  const w = t().outbox
  if (r.by === 'policy') return w.byPolicy
  if (r.confirm?.how === 'chat') return w.saidInChat(short(r.confirm.said ?? '', 20))
  return r.original !== undefined ? w.editedByYou : w.pressedSend
}

export function outboxTab($: Engine, ui: Els, s: Snapshot, edit: Record<string, string>, opened: string[] = []) {
  const { Box, Text, Button } = ui
  const w = t().outbox
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
          <Text color="suggestion">{r.status === 'sending' ? w.sending : w.queued}{t().colon}{whatOf(r)}{r.kind === 'approve' ? '' : t().quote(short(r.body, 30))}</Text>
          {r.status === 'queued' && <Button key={`ud${r.id}`} onPress={() => act($, w.undo, ['reply', 'undo', String(r.id)])}>{w.undo}</Button>}
        </Box>
      ))}
      {toSend.length === 0 && inFlight.length === 0 && <Text color="success">{w.nothing}</Text>}
      {toSend.map(card)}
      {sentToday.length > 0 && <Box marginTop="md"><Text weight="semibold">{w.sentToday(sentToday.length)}</Text></Box>}
      {sentToday.slice(0, 10).map(r => (
        <Text key={`st${r.id}`} dimColor wrap="truncate-end">
          {whoSent(r)} · {whatOf(r)}{r.kind === 'approve' ? '' : `${t().colon}${short(r.body, 60)}`}
        </Text>
      ))}
    </Box>
  )
}

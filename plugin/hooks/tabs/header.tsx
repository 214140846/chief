// 面板顶上：主会话和引擎在不在、来源连不上、钥匙被动过、页签、攒着的批注。
import type { EngineInterface as Engine } from 'claude-code'

import { DATA_HEALTH } from '../../engine/src/shared/rules'
import type { Snapshot } from '../../types'
import { ackKeyAlerts, clearBasket, sendBasket, setTab, skipOld, unannotate, undo } from '../actions'
import { sourceName, t } from '../i18n'
import { ago, short, snoozed, type Els } from '../ui'

export function header($: Engine, ui: Els, s: Snapshot, said: string, current: string, basket: { key: string; label: string; text: string }[] = [], setupMissing = 0) {
  const { Box, Text, Button } = ui
  const w = t().header
  const toSend = s.replies.filter(r => r.status === 'pending' || r.status === 'failed').length
  const asks = s.asks.filter(a => a.status === 'open' && !s.things.some(t => t.id === a.thing && snoozed(t))).length
  // 你刚在面板上点的「不做了」「跳过积下的」：两分钟内顶上留一个撤回（更早的在进度页「最近做的」里撤）。
  const fresh = s.undo.find(x => !x.undone && x.kind !== 'mark' && Date.now() - Date.parse(x.at) < 120_000)
  const proposals = s.policy?.proposals.length ?? 0
  // 提示是「时间|文字」：只显示最近 8 秒的。
  const bar = said.indexOf('|')
  const noteText = bar > 0 && Date.now() - Number(said.slice(0, bar)) < 8000 ? said.slice(bar + 1) : ''
  const tabs: { key: 'now' | 'outbox' | 'things' | 'policy' | 'eval' | 'setup'; label: string; n: number }[] = [
    { key: 'now', label: w.tabs.now, n: asks },
    { key: 'outbox', label: w.tabs.outbox, n: toSend },
    { key: 'things', label: w.tabs.things, n: 0 },
    { key: 'policy', label: w.tabs.policy, n: proposals },
    { key: 'eval', label: w.tabs.eval, n: 0 },
    { key: 'setup', label: w.tabs.setup, n: setupMissing },
  ]
  // 连着失败两次以上的来源：一次可能只是网络抖了一下。
  const broken = Object.entries(s.health).filter(([k, h]) => h.fails >= 2 && k !== DATA_HEALTH).map(([k]) => k)
  // 数据文件坏了（引擎读到不是合法 JSON 的文件）不是连不上：单独说，带上哪个文件、另存在哪。
  const corrupt = s.health[DATA_HEALTH]
  const trouble = [broken.length > 0 ? w.unreachable(broken.map(sourceName)) : '', corrupt && !corrupt.ok ? w.corrupt : ''].filter(Boolean).join(' · ')
  return (
    <Box flexDirection="column" gap="sm">
      <Box flexDirection="row" justifyContent="space-between" alignItems="center">
        {s.hub.listening
          ? <Text size="caption" color="success">{w.listening}</Text>
          : <Text size="caption" color="warning">{w.notListening(ago(s.hub.lastAt))}</Text>}
        {s.engineAt === null
          ? <Text size="caption" color="error">{w.engineDown}</Text>
          : trouble !== '' ? <Text size="caption" color="error">{trouble}</Text>
          : s.unhandled > 0 ? <Text size="caption" dimColor>{w.waiting(s.unhandled)}</Text> : <Text size="caption" dimColor>{w.engineUp}</Text>}
      </Box>
      {s.engineAt !== null && corrupt && !corrupt.ok && <Text size="footnote" color="error" wrap="wrap">{w.corruptWhy(corrupt.error ?? t().noReason)}</Text>}
      {s.keyAlerts.length > 0 && (
        <Box flexDirection="column" borderStyle="round" borderColor="error" paddingX="md" paddingY="sm" gap="xs">
          <Text weight="semibold" color="error">{w.keyTitle}</Text>
          {s.keyAlerts.map((x, i) => <Text key={`ka-${i}`} size="footnote" wrap="wrap">{ago(x.at)}{t().colon}{x.what === 'reset' ? w.keyReset : w.keySet}</Text>)}
          <Text size="footnote" dimColor wrap="wrap">{w.keyHelp}</Text>
          <Button key="ack-key" onPress={() => ackKeyAlerts($, s.keyAlerts.at(-1)!.at)}>{w.keyAck}</Button>
        </Box>
      )}
      {!s.hub.listening && (
        <Box flexDirection="column" borderStyle="round" borderColor="warning" paddingX="md" paddingY="sm" gap="xs">
          <Text weight="semibold">{w.hubDownTitle}</Text>
          <Text size="footnote" dimColor wrap="wrap">{w.hubDownHelp}</Text>
          {s.unhandled > 20 && <Button key="skip-old" onPress={() => skipOld($, s.maxEvent)}>{w.skipOld(s.unhandled)}</Button>}
        </Box>
      )}
      <Box flexDirection="row" flexWrap="wrap" gap="lg" alignItems="center">
        {tabs.map(t => current === t.key
          // 当前页不是按钮：按钮里的字 App 一律画成同一个颜色，分不出选中。
          ? <Text key={`tab-${t.key}`} weight="semibold" color="claude" underline>{t.label}{t.n > 0 ? ` ${t.n}` : ''}</Text>
          : <Button key={`tab-${t.key}`} plain onPress={() => setTab($, t.key)}>{t.n > 0 ? `${t.label} ${t.n}` : t.label}</Button>)}
      </Box>
      {noteText !== '' && <Text size="footnote" color="suggestion">{noteText}</Text>}
      {fresh && (
        <Box flexDirection="row" gap="sm" alignItems="center">
          <Box flexShrink={1}><Text size="footnote" wrap="truncate-end"><Text dimColor>{w.justDid}</Text>{fresh.label}</Text></Box>
          <Button key="undo-fresh" onPress={() => undo($, fresh.id)}>{w.undo}</Button>
        </Box>
      )}
      {basket.length > 0 && (
        <Box flexDirection="column" borderStyle="round" borderColor="claude" paddingX="md" paddingY="sm" gap="xs">
          <Text weight="semibold">{w.basket(basket.length)}</Text>
          {basket.map((x, i) => (
            <Box key={`bk-${i}`} flexDirection="row" gap="sm" alignItems="flex-start">
              <Box flexGrow={1} flexShrink={1}>
                <Text size="footnote" wrap="wrap">{x.key === 'note' ? '' : <Text dimColor>{short(x.label.replace(/[#＃]\d+\s*/g, ''), 30)}　</Text>}{x.text}</Text>
              </Box>
              <Button key={`unb-${i}`} plain onPress={() => unannotate($, i)}>✕</Button>
            </Box>
          ))}
          <Box flexDirection="row" gap="sm" marginTop="xs">
            <Button key="send-basket" variant="primary" onPress={() => sendBasket($)}>{w.sendBasket}</Button>
            <Button key="clear-basket" onPress={() => clearBasket($)}>{w.clearBasket}</Button>
          </Box>
        </Box>
      )}
    </Box>
  )
}

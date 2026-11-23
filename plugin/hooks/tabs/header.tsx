// 面板顶上：主会话和引擎在不在、来源连不上、钥匙被动过、页签、攒着的批注。
import type { EngineInterface as Engine } from 'claude-code'

import { DATA_HEALTH } from '../../engine/src/shared/rules'
import { sourceLabel } from '../../engine/src/shared/sources'
import type { Snapshot } from '../../types'
import { ackKeyAlerts, clearBasket, sendBasket, setTab, skipOld, unannotate } from '../actions'
import { ago, short, type Els } from '../ui'

export function header($: Engine, ui: Els, s: Snapshot, said: string, current: string, basket: { key: string; label: string; text: string }[] = [], setupMissing = 0) {
  const { Box, Text, Button } = ui
  const toSend = s.replies.filter(r => r.status === 'pending' || r.status === 'failed').length
  const asks = s.asks.filter(a => a.status === 'open').length
  const proposals = s.policy?.proposals.length ?? 0
  // 提示是「时间|文字」：只显示最近 8 秒的。
  const bar = said.indexOf('|')
  const noteText = bar > 0 && Date.now() - Number(said.slice(0, bar)) < 8000 ? said.slice(bar + 1) : ''
  const tabs: { key: 'now' | 'outbox' | 'things' | 'policy' | 'eval' | 'setup'; label: string; n: number }[] = [
    { key: 'now', label: '现在要你', n: asks },
    { key: 'outbox', label: '待发出', n: toSend },
    { key: 'things', label: '进度', n: 0 },
    { key: 'policy', label: '策略', n: proposals },
    { key: 'eval', label: '测评', n: 0 },
    { key: 'setup', label: '设置', n: setupMissing },
  ]
  // 连着失败两次以上的来源：一次可能只是网络抖了一下。
  const broken = Object.entries(s.health).filter(([k, h]) => h.fails >= 2 && k !== DATA_HEALTH).map(([k]) => k)
  // 数据文件坏了（引擎读到不是合法 JSON 的文件）不是连不上：单独说，带上哪个文件、另存在哪。
  const corrupt = s.health[DATA_HEALTH]
  const trouble = [broken.length > 0 ? `${broken.map(sourceLabel).join('、')} 连不上` : '', corrupt && !corrupt.ok ? '数据文件坏了' : ''].filter(Boolean).join(' · ')
  return (
    <Box flexDirection="column" gap="sm">
      <Box flexDirection="row" justifyContent="space-between" alignItems="center">
        {s.hub.listening
          ? <Text size="caption" color="success">● 主会话在听</Text>
          : <Text size="caption" color="warning">● 主会话没在听 · 上次 {ago(s.hub.lastAt)}</Text>}
        {s.engineAt === null
          ? <Text size="caption" color="error">引擎没在跑</Text>
          : trouble !== '' ? <Text size="caption" color="error">{trouble}</Text>
          : s.unhandled > 0 ? <Text size="caption" dimColor>{s.unhandled} 条等判断</Text> : <Text size="caption" dimColor>引擎在跑</Text>}
      </Box>
      {s.engineAt !== null && corrupt && !corrupt.ok && <Text size="footnote" color="error" wrap="wrap">数据文件坏了：{corrupt.error ?? '没说为什么'}</Text>}
      {s.keyAlerts.length > 0 && (
        <Box flexDirection="column" borderStyle="round" borderColor="error" paddingX="md" paddingY="sm" gap="xs">
          <Text weight="semibold" color="error">「以你的名义发」的钥匙被动过</Text>
          {s.keyAlerts.map((x, i) => <Text key={`ka-${i}`} size="footnote" wrap="wrap">{ago(x.at)}：{x.what === 'reset' ? '钥匙被清掉了' : '配了一把新钥匙'}</Text>)}
          <Text size="footnote" dimColor wrap="wrap">是你自己在终端里 chief key reset、再重新加载了插件，就点知道了。不是你：有人（可能是被消息带偏的主会话）想以你的名义发东西，先停下主会话，到「待发出」看有没有你没点过的，再在终端里 chief key reset、重新加载插件。</Text>
          <Button key="ack-key" onPress={() => ackKeyAlerts($, s.keyAlerts.at(-1)!.at)}>是我换的，知道了</Button>
        </Box>
      )}
      {!s.hub.listening && (
        <Box flexDirection="column" borderStyle="round" borderColor="warning" paddingX="md" paddingY="sm" gap="xs">
          <Text weight="semibold">新消息现在没人判断</Text>
          <Text size="footnote" dimColor wrap="wrap">在这个会话里发 /chief:hub，它会接着处理。</Text>
          {s.unhandled > 20 && <Button key="skip-old" onPress={() => skipOld($, s.maxEvent)}>跳过积下的 {s.unhandled} 条</Button>}
        </Box>
      )}
      <Box flexDirection="row" flexWrap="wrap" gap="lg" alignItems="center">
        {tabs.map(t => current === t.key
          // 当前页不是按钮：按钮里的字 App 一律画成同一个颜色，分不出选中。
          ? <Text key={`tab-${t.key}`} weight="semibold" color="claude" underline>{t.label}{t.n > 0 ? ` ${t.n}` : ''}</Text>
          : <Button key={`tab-${t.key}`} plain onPress={() => setTab($, t.key)}>{t.n > 0 ? `${t.label} ${t.n}` : t.label}</Button>)}
      </Box>
      {noteText !== '' && <Text size="footnote" color="suggestion">{noteText}</Text>}
      {basket.length > 0 && (
        <Box flexDirection="column" borderStyle="round" borderColor="claude" paddingX="md" paddingY="sm" gap="xs">
          <Text weight="semibold">要发给主会话的批注 · {basket.length}</Text>
          {basket.map((x, i) => (
            <Box key={`bk-${i}`} flexDirection="row" gap="sm" alignItems="flex-start">
              <Box flexGrow={1} flexShrink={1}>
                <Text size="footnote" wrap="wrap">{x.key === 'note' ? '' : <Text dimColor>{short(x.label.replace(/[#＃]\d+\s*/g, ''), 30)}　</Text>}{x.text}</Text>
              </Box>
              <Button key={`unb-${i}`} plain onPress={() => unannotate($, i)}>✕</Button>
            </Box>
          ))}
          <Box flexDirection="row" gap="sm" marginTop="xs">
            <Button key="send-basket" variant="primary" onPress={() => sendBasket($)}>一起发给主会话</Button>
            <Button key="clear-basket" onPress={() => clearBasket($)}>清空</Button>
          </Box>
        </Box>
      )}
    </Box>
  )
}

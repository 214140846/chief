// 「策略」页：每种消息怎么办、回复要不要你确认、白名单、「一定问我」、固定回复、写法、署名、你的规矩、它提议的规矩。
import type { EngineInterface as Engine, RenderChildren } from 'claude-code'

import { AUDIENCE_LABELS, DEFAULT_PLACEMENT, DEFAULT_SIGNATURE, HANDLE_LABELS, REPLY_MODE_SHORT } from '../../engine/src/shared/rules'
import type { Handle, ReplyMode, Rule, Snapshot } from '../../types'
import { addCustom, addQuick, addRule, addStyle, askAlways, decideProposal, removeCustom, removeQuick, removeRule, removeStyle, setBrief, setPlacement, setScenario, setSignature, toggle, trust } from '../actions'
import { SCENARIO, select, type Els } from '../ui'

// 下拉里的做法、回复要不要确认：名字和 chief 命令行同一份（engine/src/shared/rules.ts）。
const HANDLES = Object.entries(HANDLE_LABELS).map(([value, label]) => ({ value: value as Handle, label }))

const MODES = Object.entries(REPLY_MODE_SHORT).map(([value, label]) => ({ value: value as ReplyMode, label }))

export function policyTab($: Engine, ui: Els, s: Snapshot, opened: string[]) {
  const { Box, Text, Button } = ui
  const p = s.policy
  if (p === null) return <Text dimColor>正在读规矩…</Text>
  const helpOpen = opened.includes('policy-help')

  // 一条规矩：左边是什么情况，右边两个下拉；下面一行是交代（点了才出输入框）。
  const ruleRow = (target: string, label: string, r: Rule, onRemove?: () => void) => {
    const bk = `brief-${target}`
    const editing = opened.includes(bk)
    const takesBrief = r.handle === 'dispatch' || r.handle === 'approve'
    return (
      <Box key={`sc-${target}`} flexDirection="column" gap="xs" paddingY="xs">
        <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap="sm" flexWrap="wrap">
          <Box flexGrow={1} flexShrink={1} minWidth={16}><Text wrap="wrap">{label}</Text></Box>
          <Box flexDirection="row" gap="sm" alignItems="center">
            {select(ui, `h-${target}`, r.handle, target === 'slack_self' ? HANDLES : HANDLES.filter(h => h.value !== 'command'), val => void setScenario($, target, 'handle', val as Handle))}
            {r.handle !== 'ignore' && r.handle !== 'note' && select(ui, `m-${target}`, r.reply, MODES, val => void setScenario($, target, 'reply', val as ReplyMode))}
          </Box>
        </Box>
        {takesBrief && (
          <Box flexDirection="row" gap="sm" alignItems="center">
            {r.brief
              ? <Text size="footnote" dimColor wrap="wrap">交代：{r.brief}</Text>
              : null}
            <Button key={`eb-${target}`} plain onPress={() => toggle($, bk)}>{editing ? '收起' : r.brief ? '改交代' : '+ 加交代'}</Button>
            {onRemove && <Button key={`rmc-${target}`} plain onPress={onRemove}>删除</Button>}
          </Box>
        )}
        {!takesBrief && onRemove && <Button key={`rmc-${target}`} plain onPress={onRemove}>删除</Button>}
        {takesBrief && editing && 'Input' in ui && (
          <ui.Input key={`bf-${target}`} value={r.brief ?? ''} submitLabel="存" autoFocus
            placeholder={r.handle === 'approve' ? '什么情况下不 approve（比如：CI 没过的先问我）' : '派这类活时交代什么（比如：review 先看有没有测试）'}
            onSubmit={(val: string) => { void setBrief($, target, val.trim()); void toggle($, bk) }} />
        )}
      </Box>
    )
  }

  // 每一块规矩框起来，一眼分得清层级。
  const section = (key: string, text: string, sub: string | undefined, ...body: RenderChildren[]) => (
    <Box key={key} flexDirection="column" borderStyle="round" borderColor="inactive" paddingX="md" paddingY="sm" gap="xs" marginTop="sm">
      <Box flexDirection="column">
        <Text weight="semibold">{text}</Text>
        {sub && <Text size="caption" dimColor wrap="wrap">{sub}</Text>}
      </Box>
      {body}
    </Box>
  )

  return (
    <Box flexDirection="column" marginTop="sm">
      {p.proposals.length > 0 && (
        <Box flexDirection="column" borderStyle="round" borderColor="suggestion" paddingX="md" paddingY="sm" gap="sm">
          <Text weight="semibold">它提议的规矩 · {p.proposals.length}</Text>
          {p.proposals.map(x => (
            <Box key={`pp${x.id}`} flexDirection="column" gap="xs">
              <Text wrap="wrap">{x.text}</Text>
              {x.basis !== '' && <Text size="caption" dimColor wrap="wrap">依据：{x.basis}</Text>}
              <Box flexDirection="row" gap="sm">
                <Button key={`pa${x.id}`} variant="primary" onPress={() => decideProposal($, x.id, true)}>采纳</Button>
                <Button key={`pr${x.id}`} onPress={() => decideProposal($, x.id, false)}>不要</Button>
              </Box>
            </Box>
          ))}
        </Box>
      )}

      <Box flexDirection="row" justifyContent="space-between" alignItems="center">
        <Text size="caption" dimColor>改了马上生效：主会话每次判断前都重新读</Text>
        <Button key="policy-help" plain onPress={() => toggle($, 'policy-help')}>{helpOpen ? '收起说明' : '选项是什么意思？'}</Button>
      </Box>
      {helpOpen && (
        <Box flexDirection="column" gap="xs" marginTop="xs" paddingLeft="sm">
          <Text size="footnote" dimColor wrap="wrap">派人去办 — 送进在做这件事的会话，没有就挑目录开新会话，交代原样带过去</Text>
          <Text size="footnote" dimColor wrap="wrap">只记下 — 记进那件事的进展，不派活、不打扰你（「PR 合了」「好的收到」）</Text>
          <Text size="footnote" dimColor wrap="wrap">忽略 — 连记都不记</Text>
          <Text size="footnote" dimColor wrap="wrap">直接 approve PR — 找出消息里的 PR，看过状态再 approve</Text>
          <Text size="footnote" dimColor wrap="wrap">当成我的指令 — 你自己说的话，照办</Text>
          <Text size="footnote" dimColor wrap="wrap">对外先问我 / 直接发 — 回复和 approve 要不要你点头；直接发也有 5 秒能在「待发出」撤回</Text>
        </Box>
      )}

      {section('sec-trusted', '白名单：回这些人直接发', '名单里的人，替你写好的回复不用你确认就发（仍有 5 秒能撤回）；「一定问我」名单里的照样问你。写 Slack 用户编号（U…，最稳：显示名谁都能改），或完整的显示名（一字不差，不分大小写）',
        (p.trusted ?? []).length === 0 && <Text key="tr-none" size="footnote" dimColor>还没有。</Text>,
        (p.trusted ?? []).map((x, i) => (
          <Box key={`tr${i}`} flexDirection="row" justifyContent="space-between" alignItems="center" paddingY="xs">
            <Text>{x}</Text>
            <Button key={`rtr${i}`} plain onPress={() => trust($, x, false)}>移出</Button>
          </Box>
        )),
        'Input' in ui && (
          <Box key="tr-add" width="100%"><ui.Input key="add-trusted" placeholder="Slack 用户编号或完整显示名，比如：U0123ABCD" submitLabel="加上" onSubmit={(v: string) => {
            if (v.trim()) void trust($, v.trim(), true)
          }} /></Box>
        ))}

      {section('sec-always', '一定问我：这些人、对话的回复都要你点头', '名单里的人、频道和私信，回复和 approve 一律等你确认，白名单、固定回复、直接发的规矩都不管用（引擎发之前会再核一遍）。写 Slack 用户编号（U…）、频道 / 私信编号（C… / D…），或完整的显示名',
        (p.askAlways ?? []).length === 0 && <Text key="aa-none" size="footnote" dimColor>还没有。</Text>,
        (p.askAlways ?? []).map((x, i) => (
          <Box key={`aa${i}`} flexDirection="row" justifyContent="space-between" alignItems="center" paddingY="xs">
            <Text>{x}</Text>
            <Button key={`raa${i}`} plain onPress={() => askAlways($, x, false)}>移出</Button>
          </Box>
        )),
        'Input' in ui && (
          <Box key="aa-add" width="100%"><ui.Input key="add-always" placeholder="比如：U0123ABCD 或 C0123ABCD" submitLabel="加上" onSubmit={(v: string) => {
            if (v.trim()) void askAlways($, v.trim(), true)
          }} /></Box>
        ))}

      {section('sec-custom', '我加的情况', '主会话先拿消息对这些，对上了就照它办',
        p.custom.length === 0 && <Text key="cu-none" size="footnote" dimColor>还没有。</Text>,
        p.custom.map(c => ruleRow(`custom:${c.id}`, c.when, c, () => void removeCustom($, c.id))),
        'Input' in ui && (
          <Box key="cu-add" width="100%"><ui.Input key="add-custom" placeholder="加一种情况，比如：Jira 上 QA 提的 bug 指给我" submitLabel="加上" onSubmit={(v: string) => {
            if (v.trim()) void addCustom($, v.trim())
          }} /></Box>
        ))}

      {section('sec-scenarios', '每种消息', '没对上「我加的情况」的，按消息的种类办',
        Object.entries(p.scenarios).map(([k, v]) => ruleRow(k, SCENARIO[k] ?? k, v)))}

      {section('sec-quick', '固定回复：可以不问你直接发的话', '回复和下面某一句一字不差，才能不问你直接发（署名标 not reviewed）。多一个字、换个说法都要你确认。你写的规矩只管怎么写，不能让主会话直接发',
        (p.quick ?? []).length === 0 && <Text key="qk-none" size="footnote" dimColor>还没有。</Text>,
        (p.quick ?? []).map((x, i) => (
          <Box key={`qk${i}`} flexDirection="row" gap="sm" alignItems="flex-start" paddingY="xs">
            <Box flexGrow={1} flexShrink={1}><Text wrap="wrap">{x}</Text></Box>
            <Button key={`rqk${i}`} plain onPress={() => removeQuick($, x)}>删除</Button>
          </Box>
        )),
        'Input' in ui && (
          <Box key="qk-add" width="100%"><ui.Input key="add-quick" placeholder="比如：approve 了 ✅" submitLabel="加上" onSubmit={(v: string) => {
            if (v.trim()) void addQuick($, v.trim())
          }} /></Box>
        ))}

      {section('sec-style', '回复写法', '替你写的话都照这几条写；你在待发出里改过稿子，主会话会据此提议新的写法',
        (p.style ?? []).map((x, i) => (
          <Box key={`st${i}`} flexDirection="row" gap="sm" alignItems="flex-start" paddingY="xs">
            <Box flexGrow={1} flexShrink={1}><Text wrap="wrap">{x}</Text></Box>
            <Button key={`rst${i}`} plain onPress={() => removeStyle($, x)}>删除</Button>
          </Box>
        )),
        'Input' in ui && (
          <Box key="st-add" width="100%"><ui.Input key="add-style" placeholder="加一条写法，比如：不用「您」，直接叫名字" submitLabel="加上" onSubmit={(v: string) => {
            if (v.trim()) void addStyle($, v.trim())
          }} /></Box>
        ))}

      {section('sec-placement', 'Slack 回复放哪', '对方本来在 thread 里说的，总是回到那个 thread；其余按对话的种类',
        (Object.entries(AUDIENCE_LABELS) as [keyof typeof AUDIENCE_LABELS, string][]).map(([k, label]) => (
          <Box key={`pl-${k}`} flexDirection="row" justifyContent="space-between" alignItems="center" gap="sm" paddingY="xs">
            <Text>{label}</Text>
            {select(ui, `pl-${k}`, (p.placement ?? DEFAULT_PLACEMENT)[k], [{ value: 'inline', label: '直接回在对话里' }, { value: 'thread', label: '回到 thread' }], v => void setPlacement($, k, v as 'inline' | 'thread'))}
          </Box>
        )))}

      {section('sec-signature', 'Slack 回复的署名', '替你发到 Slack 的话，正文上方加一行灰色小字「署名 · confirmed by 你」（不进正文），让对方一眼知道是 agent 代回的；清空就不加',
        'Input' in ui
          ? <ui.Input key="signature" value={p.signature ?? DEFAULT_SIGNATURE} submitLabel="存" onSubmit={(v: string) => void setSignature($, v.trim())} />
          : <Text key="sig">{p.signature ?? DEFAULT_SIGNATURE}</Text>)}

      {section('sec-notes', '我的规矩', '一句话，主会话判断时最优先。只有主会话读，引擎不认：写「一定问我」管不住直接发，要拦住某个人或对话，加进上面的「一定问我」名单',
        p.notes.length === 0 && <Text key="nt-none" size="footnote" dimColor>还没有。</Text>,
        p.notes.map((n, i) => (
          <Box key={`nt${i}`} flexDirection="row" gap="sm" alignItems="flex-start" paddingY="xs">
            <Box flexGrow={1} flexShrink={1}><Text wrap="wrap">{n}</Text></Box>
            <Button key={`rm${i}`} plain onPress={() => removeRule($, n)}>删除</Button>
          </Box>
        )),
        'Input' in ui && (
          <Box key="nt-add" width="100%"><ui.Input key="add-rule" placeholder="加一条，比如：涉及排期的都要问我" submitLabel="加上" onSubmit={(v: string) => {
            if (v.trim()) void addRule($, v.trim())
          }} /></Box>
        ))}
    </Box>
  )
}

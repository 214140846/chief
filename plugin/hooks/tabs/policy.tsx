// 「策略」页：每种消息怎么办、回复要不要你确认、白名单、「一定问我」、固定回复、写法、署名、你的规矩、它提议的规矩。
import type { EngineInterface as Engine, RenderChildren } from 'claude-code'

import { DEFAULT_PLACEMENT, DEFAULT_SIGNATURE } from '../../engine/src/shared/rules'
import type { Handle, ReplyMode, Rule, Snapshot } from '../../types'
import { addCustom, addQuick, addRule, addStyle, askAlways, decideProposal, removeCustom, removeQuick, removeRule, removeStyle, setBrief, setPlacement, setScenario, setSignature, toggle, trust } from '../actions'
import { L, t } from '../i18n'
import { scenarioName, select, type Els } from '../ui'

// 下拉里的做法、回复要不要确认：名字和 chief 命令行同一份（engine/src/shared/rules.ts）。
const handles = () => Object.entries(L().handle).map(([value, label]) => ({ value: value as Handle, label }))

const modes = () => Object.entries(L().replyModeShort).map(([value, label]) => ({ value: value as ReplyMode, label }))

export function policyTab($: Engine, ui: Els, s: Snapshot, opened: string[]) {
  const { Box, Text, Button } = ui
  const w = t().policy
  const HANDLES = handles()
  const MODES = modes()
  const p = s.policy
  if (p === null) return <Text dimColor>{w.loading}</Text>
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
              ? <Text size="footnote" dimColor wrap="wrap">{w.brief(r.brief)}</Text>
              : null}
            <Button key={`eb-${target}`} plain onPress={() => toggle($, bk)}>{editing ? w.collapse : r.brief ? w.editBrief : w.addBrief}</Button>
            {onRemove && <Button key={`rmc-${target}`} plain onPress={onRemove}>{w.remove}</Button>}
          </Box>
        )}
        {!takesBrief && onRemove && <Button key={`rmc-${target}`} plain onPress={onRemove}>{w.remove}</Button>}
        {takesBrief && editing && 'Input' in ui && (
          <ui.Input key={`bf-${target}`} value={r.brief ?? ''} submitLabel={w.save} autoFocus
            placeholder={r.handle === 'approve' ? w.approveBrief : w.dispatchBrief}
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
          <Text weight="semibold">{w.proposals(p.proposals.length)}</Text>
          {p.proposals.map(x => (
            <Box key={`pp${x.id}`} flexDirection="column" gap="xs">
              <Text wrap="wrap">{x.text}</Text>
              {x.basis !== '' && <Text size="caption" dimColor wrap="wrap">{w.basis(x.basis)}</Text>}
              <Box flexDirection="row" gap="sm">
                <Button key={`pa${x.id}`} variant="primary" onPress={() => decideProposal($, x.id, true)}>{w.accept}</Button>
                <Button key={`pr${x.id}`} onPress={() => decideProposal($, x.id, false)}>{w.reject}</Button>
              </Box>
            </Box>
          ))}
        </Box>
      )}

      <Box flexDirection="row" justifyContent="space-between" alignItems="center">
        <Text size="caption" dimColor>{w.live}</Text>
        <Button key="policy-help" plain onPress={() => toggle($, 'policy-help')}>{helpOpen ? w.hideHelp : w.showHelp}</Button>
      </Box>
      {helpOpen && (
        <Box flexDirection="column" gap="xs" marginTop="xs" paddingLeft="sm">
          {w.help.map((x, i) => <Text key={`ph${i}`} size="footnote" dimColor wrap="wrap">{x}</Text>)}
        </Box>
      )}

      {section('sec-trusted', w.trustedTitle, w.trustedSub,
        (p.trusted ?? []).length === 0 && <Text key="tr-none" size="footnote" dimColor>{w.none}</Text>,
        (p.trusted ?? []).map((x, i) => (
          <Box key={`tr${i}`} flexDirection="row" justifyContent="space-between" alignItems="center" paddingY="xs">
            <Text>{x}</Text>
            <Button key={`rtr${i}`} plain onPress={() => trust($, x, false)}>{w.removeFrom}</Button>
          </Box>
        )),
        'Input' in ui && (
          <Box key="tr-add" width="100%"><ui.Input key="add-trusted" placeholder={w.trustedPlaceholder} submitLabel={w.add} onSubmit={(v: string) => {
            if (v.trim()) void trust($, v.trim(), true)
          }} /></Box>
        ))}

      {section('sec-always', w.alwaysTitle, w.alwaysSub,
        (p.askAlways ?? []).length === 0 && <Text key="aa-none" size="footnote" dimColor>{w.none}</Text>,
        (p.askAlways ?? []).map((x, i) => (
          <Box key={`aa${i}`} flexDirection="row" justifyContent="space-between" alignItems="center" paddingY="xs">
            <Text>{x}</Text>
            <Button key={`raa${i}`} plain onPress={() => askAlways($, x, false)}>{w.removeFrom}</Button>
          </Box>
        )),
        'Input' in ui && (
          <Box key="aa-add" width="100%"><ui.Input key="add-always" placeholder={w.alwaysPlaceholder} submitLabel={w.add} onSubmit={(v: string) => {
            if (v.trim()) void askAlways($, v.trim(), true)
          }} /></Box>
        ))}

      {section('sec-custom', w.customTitle, w.customSub,
        p.custom.length === 0 && <Text key="cu-none" size="footnote" dimColor>{w.none}</Text>,
        p.custom.map(c => ruleRow(`custom:${c.id}`, c.when, c, () => void removeCustom($, c.id))),
        'Input' in ui && (
          <Box key="cu-add" width="100%"><ui.Input key="add-custom" placeholder={w.customPlaceholder} submitLabel={w.add} onSubmit={(v: string) => {
            if (v.trim()) void addCustom($, v.trim())
          }} /></Box>
        ))}

      {section('sec-scenarios', w.scenariosTitle, w.scenariosSub,
        Object.entries(p.scenarios).map(([k, v]) => ruleRow(k, scenarioName(k), v)))}

      {section('sec-quick', w.quickTitle, w.quickSub,
        (p.quick ?? []).length === 0 && <Text key="qk-none" size="footnote" dimColor>{w.none}</Text>,
        (p.quick ?? []).map((x, i) => (
          <Box key={`qk${i}`} flexDirection="row" gap="sm" alignItems="flex-start" paddingY="xs">
            <Box flexGrow={1} flexShrink={1}><Text wrap="wrap">{x}</Text></Box>
            <Button key={`rqk${i}`} plain onPress={() => removeQuick($, x)}>{w.remove}</Button>
          </Box>
        )),
        'Input' in ui && (
          <Box key="qk-add" width="100%"><ui.Input key="add-quick" placeholder={w.quickPlaceholder} submitLabel={w.add} onSubmit={(v: string) => {
            if (v.trim()) void addQuick($, v.trim())
          }} /></Box>
        ))}

      {section('sec-style', w.styleTitle, w.styleSub,
        (p.style ?? []).map((x, i) => (
          <Box key={`st${i}`} flexDirection="row" gap="sm" alignItems="flex-start" paddingY="xs">
            <Box flexGrow={1} flexShrink={1}><Text wrap="wrap">{x}</Text></Box>
            <Button key={`rst${i}`} plain onPress={() => removeStyle($, x)}>{w.remove}</Button>
          </Box>
        )),
        'Input' in ui && (
          <Box key="st-add" width="100%"><ui.Input key="add-style" placeholder={w.stylePlaceholder} submitLabel={w.add} onSubmit={(v: string) => {
            if (v.trim()) void addStyle($, v.trim())
          }} /></Box>
        ))}

      {section('sec-placement', w.placementTitle, w.placementSub,
        (Object.entries(L().audience) as [keyof typeof DEFAULT_PLACEMENT, string][]).map(([k, label]) => (
          <Box key={`pl-${k}`} flexDirection="row" justifyContent="space-between" alignItems="center" gap="sm" paddingY="xs">
            <Text>{label}</Text>
            {select(ui, `pl-${k}`, (p.placement ?? DEFAULT_PLACEMENT)[k], [{ value: 'inline', label: w.inline }, { value: 'thread', label: w.thread }], v => void setPlacement($, k, v as 'inline' | 'thread'))}
          </Box>
        )))}

      {section('sec-signature', w.signatureTitle, w.signatureSub,
        'Input' in ui
          ? <ui.Input key="signature" value={p.signature ?? DEFAULT_SIGNATURE} submitLabel={w.save} onSubmit={(v: string) => void setSignature($, v.trim())} />
          : <Text key="sig">{p.signature ?? DEFAULT_SIGNATURE}</Text>)}

      {section('sec-notes', w.notesTitle, w.notesSub,
        p.notes.length === 0 && <Text key="nt-none" size="footnote" dimColor>{w.none}</Text>,
        p.notes.map((n, i) => (
          <Box key={`nt${i}`} flexDirection="row" gap="sm" alignItems="flex-start" paddingY="xs">
            <Box flexGrow={1} flexShrink={1}><Text wrap="wrap">{n}</Text></Box>
            <Button key={`rm${i}`} plain onPress={() => removeRule($, n)}>{w.remove}</Button>
          </Box>
        )),
        'Input' in ui && (
          <Box key="nt-add" width="100%"><ui.Input key="add-rule" placeholder={w.notesPlaceholder} submitLabel={w.add} onSubmit={(v: string) => {
            if (v.trim()) void addRule($, v.trim())
          }} /></Box>
        ))}
    </Box>
  )
}

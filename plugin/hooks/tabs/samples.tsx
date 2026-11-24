// 样式样例（临时）：把侧边栏能用的组件和样式各画一个，编号对上截图，用来定「要你」页的设计稿。/chief samples 打开。
// 定完设计就删掉这个文件和它的入口。
import type { EngineInterface as Engine, RenderChildren } from 'claude-code'

import { setTab } from '../actions'
import type { Els } from '../ui'

const COLORS = ['text', 'subtle', 'inactive', 'suggestion', 'success', 'error', 'warning', 'claude', 'permission', 'planMode', 'autoAccept', 'remember', 'merged', 'diffAdded', 'diffRemoved', 'diffAddedDimmed', 'diffRemovedDimmed'] as const
const BORDERS = ['round', 'single', 'double', 'bold', 'classic', 'singleDouble', 'doubleSingle', 'arrow'] as const
const LONG = '设置页里点进二级页面，顶部高亮的还是一级菜单，不是当前这一页（顶部只按链接地址匹配，没用侧栏那套规则）。现在顶部加了新标识把人引进来，这个不一致会更明显。'

export function samplesTab($: Engine, ui: Els) {
  const { Box, Text, Button } = ui
  const title = (n: number, text: string) => <Text weight="semibold">{`${n}. ${text}`}</Text>
  const block = (key: string, n: number, text: string, ...body: RenderChildren[]) => (
    <Box key={key} flexDirection="column" gap="xs" marginTop="lg">
      {title(n, text)}
      {body}
    </Box>
  )

  return (
    <Box flexDirection="column" marginTop="sm">
      <Box flexDirection="row" gap="sm" alignItems="center">
        <Text dimColor size="footnote">样式样例：截图发给 Claude，按编号说哪个好看、哪个没画出来。</Text>
        <Button key="samples-back" plain onPress={() => setTab($, 'now')}>回到要你</Button>
      </Box>

      {block('s1', 1, '框的底色（Box backgroundColor）',
        <Box key="s1g" flexDirection="row" flexWrap="wrap" gap="sm">
          {COLORS.map(c => (
            <Box key={`bg-${c}`} backgroundColor={c} paddingX="sm" paddingY="xs"><Text size="footnote">{c}</Text></Box>
          ))}
        </Box>)}

      {block('s2', 2, '边框颜色（borderStyle round + borderColor）',
        <Box key="s2g" flexDirection="row" flexWrap="wrap" gap="sm">
          {COLORS.map(c => (
            <Box key={`bc-${c}`} borderStyle="round" borderColor={c} paddingX="sm"><Text size="footnote">{c}</Text></Box>
          ))}
        </Box>,
        <Text key="s2t" size="footnote" dimColor>下面一排都加了 borderDimColor（调淡）。现在「要你」里子问题的框是 inactive 这一个：</Text>,
        <Box key="s2d" flexDirection="row" flexWrap="wrap" gap="sm">
          {COLORS.map(c => (
            <Box key={`bd-${c}`} borderStyle="round" borderColor={c} borderDimColor paddingX="sm"><Text size="footnote">{`淡 ${c}`}</Text></Box>
          ))}
        </Box>)}

      {block('s3', 3, '边框样式（borderStyle）',
        <Box key="s3g" flexDirection="row" flexWrap="wrap" gap="sm">
          {BORDERS.map(b => (
            <Box key={`bs-${b}`} borderStyle={b} borderColor="inactive" paddingX="sm"><Text size="footnote">{b}</Text></Box>
          ))}
        </Box>)}

      {block('s4', 4, '字号 × 粗细（size × weight）',
        ...(['title', 'heading', 'body', 'footnote', 'caption'] as const).map(sz => (
          <Box key={`sz-${sz}`} flexDirection="row" gap="md" flexWrap="wrap" alignItems="flex-end">
            {(['regular', 'medium', 'semibold', 'bold'] as const).map(wt => <Text key={`${sz}-${wt}`} size={sz} weight={wt}>{`${sz} ${wt} 要顺手改吗`}</Text>)}
          </Box>
        )))}

      {block('s5', 5, '文字颜色（Text color）和变淡（dimColor）',
        <Box key="s5g" flexDirection="row" flexWrap="wrap" gap="md">
          {COLORS.map(c => <Text key={`tc-${c}`} color={c}>{c}</Text>)}
          <Text dimColor>dimColor</Text>
          <Text color="warning" dimColor>warning+dim</Text>
        </Box>)}

      {block('s6', 6, '文字底色、斜体、下划线、删除线、反色、等宽',
        <Box key="s6g" flexDirection="row" flexWrap="wrap" gap="md">
          <Text backgroundColor="subtle">{' 底色 subtle '}</Text>
          <Text backgroundColor="warning">{' 底色 warning '}</Text>
          <Text backgroundColor="diffAdded">{' 底色 diffAdded '}</Text>
          <Text italic>斜体</Text>
          <Text underline>下划线</Text>
          <Text strikethrough>删除线</Text>
          <Text inverse>{' 反色 '}</Text>
          <Text mono>等宽 mono 123</Text>
        </Box>)}

      {block('s7', 7, '最多几行（maxLines）和截断',
        <Box key="s7a" borderStyle="round" borderColor="inactive" paddingX="sm" flexDirection="column" gap="xs">
          <Text size="footnote" dimColor>7a maxLines：侧边栏不允许（引擎直接拒绝整页），用不了。</Text>
        </Box>,
        <Box key="s7b" borderStyle="round" borderColor="inactive" paddingX="sm" flexDirection="column" gap="xs">
          <Text size="footnote" dimColor>7b 竖排里 truncate-end：</Text>
          <Text size="footnote" wrap="truncate-end">{LONG}</Text>
        </Box>,
        <Box key="s7c" borderStyle="round" borderColor="inactive" paddingX="sm" flexDirection="row" gap="sm">
          <Box flexShrink={1}><Text size="footnote" wrap="truncate-end">{`7c 横排里 truncate-end：${LONG}`}</Text></Box>
          <Button key="s7c-b" plain onPress={() => {}}>展开</Button>
        </Box>,
        <Box key="s7d" borderStyle="round" borderColor="inactive" paddingX="sm" flexDirection="row" gap="sm">
          <Box flexShrink={1} flexGrow={1} overflow="hidden"><Text size="footnote" wrap="truncate-end">{`7d 横排 + overflow hidden：${LONG}`}</Text></Box>
          <Button key="s7d-b" plain onPress={() => {}}>展开</Button>
        </Box>)}

      {block('s8', 8, '按钮（Button）',
        <Box key="s8g" flexDirection="row" flexWrap="wrap" gap="sm" alignItems="center">
          <Button key="b-primary" variant="primary" onPress={() => {}}>primary</Button>
          <Button key="b-secondary" variant="secondary" onPress={() => {}}>secondary</Button>
          <Button key="b-default" onPress={() => {}}>默认</Button>
          <Button key="b-plain" plain onPress={() => {}}>plain</Button>
          <Button key="b-plain-dim" plain dimColor onPress={() => {}}>plain dim</Button>
          <Button key="b-dim" dimColor onPress={() => {}}>默认 dim</Button>
        </Box>)}

      {block('s9', 9, '进度条（Progress）',
        'Progress' in ui
          ? [
              <ui.Progress key="p1" label="第 2 个问题，共 6 个" value={2} max={6} />,
              <ui.Progress key="p2" label="warning 色" value={4} max={6} color="warning" valueText="4/6" />,
            ]
          : <Text key="p-none" dimColor>这个界面没有 Progress</Text>)}

      {block('s10', 10, 'Svg：分隔线、小圆点',
        'Svg' in ui
          ? [
              <Text key="sv-a" size="footnote">上面一段</Text>,
              <ui.Svg key="sv-line" source={'<svg xmlns="http://www.w3.org/2000/svg" width="400" height="9" viewBox="0 0 400 9"><line x1="0" y1="4.5" x2="400" y2="4.5" stroke="#8A8F98" stroke-opacity="0.35" stroke-width="1"/></svg>'} alt="分隔线" />,
              <Text key="sv-b" size="footnote">下面一段</Text>,
              <ui.Svg key="sv-dots" source={'<svg xmlns="http://www.w3.org/2000/svg" width="140" height="8" viewBox="0 0 140 8"><rect x="0" y="2" width="20" height="4" rx="2" fill="#141413"/><rect x="24" y="2" width="20" height="4" rx="2" fill="#D97757"/><rect x="48" y="2" width="20" height="4" rx="2" fill="#8A8F98" fill-opacity="0.3"/><rect x="72" y="2" width="20" height="4" rx="2" fill="#8A8F98" fill-opacity="0.3"/><rect x="96" y="2" width="20" height="4" rx="2" fill="#8A8F98" fill-opacity="0.3"/><rect x="120" y="2" width="20" height="4" rx="2" fill="#8A8F98" fill-opacity="0.3"/></svg>'} alt="第 2 个，共 6 个" />,
            ]
          : <Text key="sv-none" dimColor>这个界面没有 Svg</Text>)}

      {block('s11', 11, '悬停（hover）：11a 鼠标放上去变底色；11b 放上去才出现按钮',
        <Box key="s11a" borderStyle="round" borderColor="inactive" paddingX="sm" paddingY="xs" hover={{ backgroundColor: 'subtle' }}>
          <Text size="footnote">11a 把鼠标放在这一块上</Text>
        </Box>,
        <Box key="s11b" borderStyle="round" borderColor="inactive" paddingX="sm" paddingY="xs" flexDirection="row" gap="sm" alignItems="center" hover={{ scope: 'chief-s11b' }}>
          <Text size="footnote">11b 把鼠标放在这一行上 →</Text>
          <Box display="none" hover={{ scope: 'chief-s11b', display: 'flex' }} flexDirection="row" gap="xs">
            <Button key="s11b-1" plain onPress={() => {}}>不同意…</Button>
            <Button key="s11b-2" plain onPress={() => {}}>不用问了</Button>
          </Box>
        </Box>)}

      {block('s12', 12, '组合：底色卡、底色卡里套边框卡、彩色边框卡',
        <Box key="s12a" backgroundColor="subtle" paddingX="md" paddingY="sm" flexDirection="column" gap="xs">
          <Text weight="semibold">12a subtle 底色卡</Text>
          <Text size="footnote" dimColor>背景一段灰字。</Text>
          <Box borderStyle="round" borderColor="inactive" paddingX="sm" flexDirection="column">
            <Text size="footnote">12b 里面套一张边框卡</Text>
          </Box>
        </Box>,
        <Box key="s12c" backgroundColor="diffRemovedDimmed" paddingX="md" paddingY="sm" flexDirection="column" gap="xs">
          <Text weight="semibold" color="error">12c diffRemovedDimmed 底色：会话在等你点</Text>
          <Text size="footnote">导出工具会话放了一张会话卡片，点一下才开工。</Text>
        </Box>,
        <Box key="s12d" borderStyle="round" borderColor="error" paddingX="md" paddingY="sm" flexDirection="column" gap="xs">
          <Text weight="semibold" color="error">12d 红边框：会话在等你点</Text>
          <Text size="footnote">导出工具会话放了一张会话卡片，点一下才开工。</Text>
        </Box>)}

      {block('s13', 13, 'Link、Markdown、Code',
        'Link' in ui ? <ui.Link key="lk" href="https://github.com" label="13a Link 打开 github.com" /> : null,
        'Markdown' in ui ? <ui.Markdown key="md" text={'13b **Markdown** 的 `code`、[链接](https://github.com)\n- 列表一\n- 列表二'} /> : null,
        'Code' in ui ? <ui.Code key="cd" source={'chief ask list --thing 3'} language="bash" /> : null)}
    </Box>
  )
}

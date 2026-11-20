// 设置页：第一次装好插件后一步步打勾。装引擎、登录 Slack、连 GitHub / Jira、开消息中心。
// 引擎还没装时 ~/chief/data/bin/chief 不存在，面板只画这一页；装好以后它是最后一个页签「设置」。
import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine } from 'claude-code'

import type { Doctor, Setup } from '../types'
import { chiefDir, refresh } from './data'
import type { Els } from './views'

const setup = atom({ plugin: 'chief', key: 'setup' } as const, { installed: false, doctor: null, busy: '', said: '', cwd: '' } as Setup)

const INSTALL_MS = 10 * 60_000
const LOGIN_MS = 6 * 60_000

async function installed($: Engine): Promise<boolean> {
  try {
    await $.fs.read(`${await chiefDir($)}/bin/chief`)
    return true
  } catch {
    return false
  }
}

// 插件自己的版本：和引擎目录里的 VERSION 对不上就提示更新。
async function pluginVersion($: Engine): Promise<string | null> {
  try {
    return (JSON.parse(await $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`)) as { version?: string }).version ?? null
  } catch {
    return null
  }
}

let wanted: string | null = null

export async function checkSetup($: Engine) {
  wanted ??= await pluginVersion($)
  const has = await installed($)
  let doctor: Doctor | null = null
  if (has) {
    const out = await $.process.run([`${await chiefDir($)}/bin/chief`, 'doctor'], { timeoutMs: 60_000 }).catch(() => null)
    try {
      doctor = out && out.exitCode === 0 ? (JSON.parse(out.stdout) as Doctor) : null
    } catch {
      doctor = null
    }
  }
  const cwd = await $.session.cwd().catch(() => '')
  await update($, setup, s => ({ ...s, installed: has, doctor, cwd }))
}

export async function readSetup($: Engine) {
  return read($, setup)
}

// 还差几步（必需的：引擎、Slack、消息中心）。
export function missing(s: Setup): number {
  const d = s.doctor
  if (!s.installed || d === null) return 3
  return [d.engine === 'running' && d.version === wanted, d.sources.slack.enabled && d.sources.slack.ready, d.hub.listening].filter(ok => !ok).length
}

async function step($: Engine, busy: Setup['busy'], run: () => Promise<{ exitCode: number; stdout: string; stderr: string } | null>) {
  await update($, setup, s => ({ ...s, busy, said: '' }))
  let said: string
  try {
    const out = await run()
    said = out === null ? '' : out.exitCode === 0 ? '' : (out.stderr.trim() || out.stdout.trim().split('\n').slice(-3).join('\n') || '没说为什么').slice(0, 400)
  } catch (error) {
    said = error instanceof Error ? error.message : String(error)
  }
  await update($, setup, (s): Setup => ({ ...s, busy: '', said }))
  await checkSetup($)
  await refresh($).catch(() => {})
}

function installEngine($: Engine) {
  return step($, 'engine', () => $.process.run(['/bin/sh', `${$.plugin.root}/setup.sh`], { timeoutMs: INSTALL_MS }))
}

async function chief($: Engine, args: string[], timeoutMs = 60_000) {
  return $.process.run([`${await chiefDir($)}/bin/chief`, ...args], { timeoutMs })
}

function loginSlack($: Engine) {
  return step($, 'slack', () => chief($, ['connect', 'slack'], LOGIN_MS))
}

function connect($: Engine, source: 'github' | 'jira') {
  return step($, source, () => chief($, ['connect', source]))
}

function recheck($: Engine) {
  return step($, 'check', async () => null)
}

function openWorkspace($: Engine, path: string) {
  void $.process.run(['/usr/bin/open', path]).catch(() => {})
}

function startHub($: Engine) {
  void $.prompt.submit({ text: '开 chief 消息中心' })
}

export function setupTab($: Engine, ui: Els, s: Setup) {
  const { Box, Text, Button } = ui
  const d = s.doctor
  const busy = s.busy !== ''
  const note = (text: string) => <Text size="footnote" dimColor wrap="wrap">{text}</Text>
  // 按钮没有「不可点」的样子：不能点的时候画成灰字。
  const button = (key: string, label: string, enabled: boolean, onPress: () => void, primary = true) => enabled
    ? (primary ? <Button key={key} variant="primary" onPress={onPress}>{label}</Button> : <Button key={key} plain onPress={onPress}>{label}</Button>)
    : <Text key={key} size="footnote" dimColor>{label}</Text>
  const row = (key: string, done: boolean, title: string, body: ReturnType<typeof note>, optional = false) => (
    <Box key={key} flexDirection="column" borderStyle="round" borderColor={done ? 'success' : undefined} paddingX="md" paddingY="sm" gap="xs">
      <Text weight="semibold">{done ? <Text color="success">✓ </Text> : '○ '}{title}{optional ? <Text dimColor>（可选）</Text> : ''}</Text>
      {body}
    </Box>
  )

  const engineOk = s.installed && d !== null && d.engine === 'running' && d.version === wanted
  const engineBody = s.busy === 'engine'
    ? note('正在装：复制引擎、装依赖、装进后台服务。第一次要一两分钟。')
    : engineOk ? (
      <Box flexDirection="column" gap="xs">
        {note(`在后台跑着（${d!.version}，Node ${d!.node}）。工作目录 ${d!.workspace.path}：CLAUDE.md 写你的交代，rules.json 是规矩，notes/ 是助理记的，data/ 是进展和消息。`)}
        {d!.workspace.ready && button('setup-workspace', '打开工作目录', !busy, () => openWorkspace($, d!.workspace.path), false)}
      </Box>
    )
    : (
      <Box flexDirection="column" gap="xs">
        {note(!s.installed ? '把收消息的后台程序装到这台电脑上，开机自动跑。chief 的东西都放在工作目录 ~/chief 里。要先装好 Node 24 以上。'
          : d?.version !== wanted ? `插件是 ${wanted ?? '?'}，引擎还是 ${d?.version ?? '旧版'}，更新一下。`
          : '装了但没在跑，重装一下。')}
        {button('setup-engine', s.installed ? '更新引擎' : '装引擎', !busy, () => void installEngine($))}
      </Box>
    )

  const slack = d?.sources.slack
  const slackOk = slack !== undefined && slack.enabled && slack.ready
  const slackBody = s.busy === 'slack'
    ? note('在弹出的 Chrome 窗口里登录 Slack，登好窗口会自己关掉。')
    : slackOk ? note('连上了')
    : (
      <Box flexDirection="column" gap="xs">
        {note(d?.chrome === false ? '要用 Google Chrome 登录：先装一个 Chrome。' : '会弹出一个单独的 Chrome 窗口，你在里面正常登录（公司 SSO 照常走）。登录凭证直接存进钥匙串，不经过聊天。')}
        {button('setup-slack', s.installed ? '登录 Slack' : '登录 Slack（先装引擎）', !busy && s.installed && d?.chrome !== false, () => void loginSlack($))}
      </Box>
    )

  const tool = (id: 'github' | 'jira', name: string, install: string, login: string) => {
    const t = d?.sources[id]
    const ok = t !== undefined && t.enabled && t.ok
    const body = s.busy === id ? note('正在试…')
      : ok ? note('连上了')
      : t === undefined || !t.tool ? note(`没找到 ${install.split(' ')[2] ?? ''}：在终端跑 ${install}，再 ${login}，然后点「重新检查」。`)
      : !t.ok ? note(`还没登录：在终端跑 ${login}，然后点「重新检查」。${t.detail ? `（${t.detail}）` : ''}`)
      : button(`setup-${id}`, `连上 ${name}`, !busy, () => void connect($, id), false)
    return row(`setup-${id}-row`, ok, name, body, true)
  }

  const hubOk = d?.hub.listening === true
  // 消息中心最好开在工作目录里：那样才读得到 CLAUDE.md、notes/ 和那里的 skill。
  const elsewhere = d !== null && d.workspace.ready && s.cwd !== '' && s.cwd !== d.workspace.path
  const hubBody = hubOk ? note('主会话在听，新消息进来会自动处理')
    : (
      <Box flexDirection="column" gap="xs">
        {note(elsewhere
          ? `这个会话开在 ${s.cwd}。消息中心最好开在工作目录：新建会话时文件夹选 ${d!.workspace.path}（权限模式选 bypass permissions），在那个会话里打 /chief 再点这里。`
          : '用这个会话当主会话：点下面的按钮，它会挂上监听、改名叫「chief 消息中心」。这个会话之后就一直开着，权限模式选 bypass permissions。')}
        {button('setup-hub', !engineOk ? '开消息中心（先装好引擎）' : elsewhere ? '就用这个会话' : '开消息中心', !busy && engineOk, () => startHub($), !elsewhere)}
      </Box>
    )

  return (
    <Box flexDirection="column" gap="sm" marginTop="sm">
      <Text weight="semibold">设置 chief</Text>
      {row('setup-engine-row', engineOk, '1. 后台引擎', engineBody)}
      {row('setup-slack-row', slackOk, '2. 登录 Slack', slackBody)}
      {tool('github', 'GitHub', 'brew install gh', 'gh auth login')}
      {tool('jira', 'Jira', 'brew install acli', 'acli jira auth login --web')}
      {row('setup-hub-row', hubOk, '3. 开消息中心', hubBody)}
      {s.said !== '' && <Text size="footnote" color="error" wrap="wrap">上一步没成：{s.said}</Text>}
      <Box flexDirection="row" gap="sm">
        {button('setup-recheck', s.busy === 'check' ? '检查中…' : '重新检查', !busy, () => void recheck($), false)}
      </Box>
    </Box>
  )
}

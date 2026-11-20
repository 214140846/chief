// 照搬 aide 的 launchd.ts。用 macOS 的 launchd 让引擎常驻：登录后自动启动，崩了自动拉起。
// 装的是「当前用户」的 LaunchAgent（~/Library/LaunchAgents），不需要管理员权限，也只在你登录时跑。
// launchd 不读你终端里的 PATH 和环境变量，所以 node 用绝对路径，密钥一律从钥匙串取。
import { execFile } from "node:child_process";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";

export const LABEL = "dev.chief.engine";

export interface PlistOptions {
  // node 的绝对路径。
  node: string;
  // 交给 node 的参数（--import tsx 和引擎脚本的绝对路径）。
  args: string[];
  workingDir: string;
  logFile: string;
  env: Record<string, string>;
}

export function plistPath(home = homedir()): string {
  return join(home, "Library", "LaunchAgents", `${LABEL}.plist`);
}

export function renderPlist(o: PlistOptions): string {
  for (const p of [o.node, o.workingDir, o.logFile]) {
    if (!p.startsWith("/")) throw new Error(`launchd 里的路径要是绝对路径：${p}`);
  }
  const env = Object.entries(o.env)
    .map(([k, v]) => `      <key>${xml(k)}</key>\n      <string>${xml(v)}</string>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${LABEL}</string>
    <key>ProgramArguments</key>
    <array>
      <string>${xml(o.node)}</string>
${o.args.map((a) => `      <string>${xml(a)}</string>`).join("\n")}
    </array>
    <key>WorkingDirectory</key>
    <string>${xml(o.workingDir)}</string>
    <key>EnvironmentVariables</key>
    <dict>
${env}
    </dict>
    <!-- 登录后启动；不是正常退出（崩溃、被杀）就重新拉起，两次之间至少隔 10 秒。 -->
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <dict>
      <key>SuccessfulExit</key>
      <false/>
    </dict>
    <key>ThrottleInterval</key>
    <integer>10</integer>
    <key>ProcessType</key>
    <string>Background</string>
    <key>StandardOutPath</key>
    <string>${xml(o.logFile)}</string>
    <key>StandardErrorPath</key>
    <string>${xml(o.logFile)}</string>
  </dict>
</plist>
`;
}

export type Runner = (args: readonly string[]) => Promise<{ code: number; stdout: string; stderr: string }>;

const launchctl: Runner = (args) => new Promise((resolve) => {
  execFile("/bin/launchctl", [...args], { timeout: 15_000 }, (error, stdout, stderr) => {
    const code = error ? (typeof (error as { code?: unknown }).code === "number" ? (error as { code: number }).code : 1) : 0;
    resolve({ code, stdout: String(stdout), stderr: String(stderr) });
  });
});

// launchctl 新写法的「域」：当前用户的图形会话。
function domain(): string {
  return `gui/${userInfo().uid}`;
}

// 装上（已经装过就先卸再装，用新的 plist）。
// bootout 是异步的：命令返回时旧进程可能还在退出，这时马上 bootstrap 会报 Input/output error。
// 所以先等旧服务真的不在了，装失败再重试几次。
export async function bootstrap(path: string, run: Runner = launchctl, wait = sleep): Promise<void> {
  const target = `${domain()}/${LABEL}`;
  await run(["bootout", target]);
  for (let i = 0; i < 20 && (await run(["print", target])).code === 0; i++) await wait(250);
  let last = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await run(["bootstrap", domain(), path]);
    if (res.code === 0) return;
    last = res.stderr.trim() || String(res.code);
    await wait(500);
  }
  throw new Error(`launchctl bootstrap 失败：${last}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function bootout(run: Runner = launchctl): Promise<boolean> {
  const res = await run(["bootout", `${domain()}/${LABEL}`]);
  return res.code === 0;
}

// 重启：杀掉现在的进程，launchd 马上再起一个。
export async function kickstart(run: Runner = launchctl): Promise<void> {
  const res = await run(["kickstart", "-k", `${domain()}/${LABEL}`]);
  if (res.code !== 0) throw new Error(`launchctl kickstart 失败：${res.stderr.trim() || res.code}`);
}

export interface ServiceState {
  loaded: boolean;
  running: boolean;
  pid: number | null;
  lastExit: string | null;
}

export async function serviceState(run: Runner = launchctl): Promise<ServiceState> {
  const res = await run(["print", `${domain()}/${LABEL}`]);
  if (res.code !== 0) return { loaded: false, running: false, pid: null, lastExit: null };
  return parsePrint(res.stdout);
}

export function parsePrint(out: string): ServiceState {
  const pid = /^\s*pid = (\d+)/m.exec(out)?.[1];
  const state = /^\s*state = (\S+)/m.exec(out)?.[1];
  const lastExit = /^\s*last exit code = (.+)$/m.exec(out)?.[1]?.trim() ?? null;
  return { loaded: true, running: state === "running", pid: pid ? Number(pid) : null, lastExit };
}

function xml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

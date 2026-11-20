// Slack 浏览器登录：开一个独立的 Chrome 窗口（全新的临时配置），你在里面自己登录；
// 等 d Cookie 真的能用（换得到 token，并且调接口不被拒），才关窗口、删临时配置，把 Cookie 交回去。Cookie 不打印。
// 要公司 SSO 的工作区，得从工作区地址（<工作区>.slack.com）登：从 slack.com/signin 登只登上了 Slack 账号，
// 工作区那步「Authenticate」在这个窗口里起不来；那样拿到的 Cookie 换得到 token，一调接口就 403、实时连接也连不上。
// 所以没给工作区时：先在 slack.com/signin 登账号，换 token 时看出是哪个工作区，再开一个工作区地址的窗口接着走 SSO。
// 思路和 gabriel-slack 的 browserLogin 一样（它没导出），这里只用 Node 自带的 fetch / WebSocket，不加依赖。
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { paths } from "../store";
import { checkSlackCookie } from "./plugin";

const CHROME = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
];
const SIGNIN_URL = "https://slack.com/signin";
const TIMEOUT_MS = 5 * 60_000;
// 同一个 Cookie 验不过（多半是 SSO 还没走完），隔这么久再验一次，不每秒都去问 Slack。
const RECHECK_MS = 5_000;

interface Cookie {
  name: string;
  value: string;
  domain: string;
}

export function findChrome(): string | null {
  return CHROME.find((p) => existsSync(p)) ?? null;
}

// 一个 Cookie 能不能用：交给 Slack 换 token、再真调一次接口，都过了才算；顺带拿到它登的工作区。
async function usable(cookie: string): Promise<{ ok: boolean; domain?: string }> {
  try {
    const r = await checkSlackCookie(cookie);
    return { ok: r.valid, ...(r.domain ? { domain: r.domain } : {}) };
  } catch {
    return { ok: false };
  }
}

function slackCookie(cookies: Cookie[]): string | null {
  const d = cookies.find((c) => c.name === "d" && /(^|\.)slack\.com$/.test(c.domain.replace(/^\./, "")) && c.value.startsWith("xoxd-"));
  return d?.value ?? null;
}

// 工作区：acme、acme.slack.com 或 https://acme.slack.com/ 都行，取出子域名。
export function workspaceUrl(workspace: string): string {
  const name = workspace.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\.slack\.com\/?$/, "").replace(/\/$/, "");
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(name)) throw new Error("工作区写成 acme 或 acme.slack.com 这样");
  return `https://${name}.slack.com/`;
}

// 交回 Cookie 和它登的工作区（子域名，知道的话），工作区记下来下次直接从那登。
export async function browserLogin(opts: { log?: (line: string) => void; timeoutMs?: number; workspace?: string } = {}): Promise<{ cookie: string; workspace?: string }> {
  const log = opts.log ?? (() => {});
  const url = opts.workspace ? workspaceUrl(opts.workspace) : SIGNIN_URL;
  const chrome = findChrome();
  if (!chrome) throw new Error("没找到 Chrome：装一个 Google Chrome 再来，或者用 chief connect slack --stdin 手动贴 Cookie");
  // 临时配置也放在 chief 的数据目录里，用完就删。
  mkdirSync(paths().home, { recursive: true, mode: 0o700 });
  const profile = mkdtempSync(join(paths().home, "login-"));
  // 端口给 0，让 Chrome 自己挑一个空的，再从配置目录里的 DevToolsActivePort 读出来；只听本机。
  const proc = spawn(chrome, [
    "--remote-debugging-port=0", "--remote-debugging-address=127.0.0.1", `--user-data-dir=${profile}`,
    "--no-first-run", "--no-default-browser-check", `--app=${url}`,
  ], { stdio: "ignore" });
  const closed = new Promise<void>((resolve) => proc.once("exit", () => resolve()));
  let ws: WebSocket | null = null;
  try {
    log("开了一个 Slack 登录窗口：在里面登录（公司 SSO、确认新设备都照做），登好窗口会自己关掉。");
    const url = await debuggerUrl(profile, proc);
    ws = await open(url);
    const call = rpc(ws);
    const deadline = Date.now() + (opts.timeoutMs ?? TIMEOUT_MS);
    let checked = "";
    let checkedAt = 0;
    let jumped = opts.workspace !== undefined;
    while (Date.now() < deadline) {
      if (proc.exitCode !== null || proc.signalCode !== null) throw new Error("登录窗口被关掉了，没登上");
      const { cookies } = await call<{ cookies?: Cookie[] }>("Storage.getCookies");
      const cookie = slackCookie(cookies ?? []);
      if (cookie && (cookie !== checked || Date.now() - checkedAt >= RECHECK_MS)) {
        checked = cookie;
        checkedAt = Date.now();
        const r = await usable(cookie);
        if (r.ok) return { cookie, ...(r.domain ? { workspace: r.domain } : {}) };
        // 账号登上了、工作区还用不了（多半要公司 SSO）：开一个工作区地址的窗口，SSO 在那边整页跳转走得通。只跳一次。
        if (!jumped && r.domain) {
          jumped = true;
          log(`登上了 Slack 账号，工作区 ${r.domain} 还要走公司 SSO：开了一个 ${r.domain}.slack.com 的窗口，在那里接着登。`);
          await call("Target.createTarget", { url: workspaceUrl(r.domain) });
        }
      }
      await sleep(1000);
    }
    throw new Error("等了 5 分钟还没登上，窗口关了；再点一次重来");
  } finally {
    ws?.close();
    proc.kill("SIGTERM");
    await Promise.race([closed, sleep(3000)]);
    rmSync(profile, { recursive: true, force: true });
  }
}

async function debuggerUrl(profile: string, proc: ReturnType<typeof spawn>): Promise<string> {
  const file = join(profile, "DevToolsActivePort");
  for (let i = 0; i < 100; i++) {
    if (proc.exitCode !== null) break;
    if (existsSync(file)) {
      const [port, path] = readFileSync(file, "utf8").split("\n");
      if (port && path) return `ws://127.0.0.1:${Number(port)}${path}`;
    }
    await sleep(200);
  }
  throw new Error("登录窗口没开起来");
}

function open(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.addEventListener("open", () => resolve(ws), { once: true });
    ws.addEventListener("error", () => reject(new Error("连不上登录窗口")), { once: true });
  });
}

function rpc(ws: WebSocket): <T>(method: string, params?: Record<string, unknown>) => Promise<T> {
  let seq = 0;
  const waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  ws.addEventListener("message", (ev) => {
    let msg: { id?: number; result?: unknown; error?: { message?: string } };
    try {
      msg = JSON.parse(String(ev.data)) as typeof msg;
    } catch {
      return;
    }
    const w = msg.id === undefined ? undefined : waiting.get(msg.id);
    if (!w || msg.id === undefined) return;
    waiting.delete(msg.id);
    if (msg.error) w.reject(new Error(msg.error.message ?? "登录窗口出错"));
    else w.resolve(msg.result ?? {});
  });
  return <T>(method: string, params?: Record<string, unknown>) => new Promise<T>((resolve, reject) => {
    const id = ++seq;
    waiting.set(id, { resolve: resolve as (v: unknown) => void, reject });
    ws.send(JSON.stringify({ id, method, ...(params ? { params } : {}) }));
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

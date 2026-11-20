// Slack 浏览器登录：开一个独立的 Chrome 窗口（全新的临时配置），你在里面自己登录；
// 等 .slack.com 的 d Cookie 出现、并且确实能用，就关窗口、删临时配置，把 Cookie 交回去。Cookie 不打印。
// 思路和 gabriel-slack 的 browserLogin 一样（它没导出），这里只用 Node 自带的 fetch / WebSocket，不加依赖。
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SlackPlugin, SLACK_COOKIE_D } from "./plugin";

const CHROME = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
];
const SIGNIN_URL = "https://slack.com/signin";
const TIMEOUT_MS = 5 * 60_000;

interface Cookie {
  name: string;
  value: string;
  domain: string;
}

export function findChrome(): string | null {
  return CHROME.find((p) => existsSync(p)) ?? null;
}

// 一个 Cookie 能不能用：交给 Slack 换一次登录，能换到才算。
async function usable(cookie: string): Promise<boolean> {
  try {
    const checks = await new SlackPlugin().test({ [SLACK_COOKIE_D]: cookie });
    return checks.every((c) => c.pass);
  } catch {
    return false;
  }
}

function slackCookie(cookies: Cookie[]): string | null {
  const d = cookies.find((c) => c.name === "d" && /(^|\.)slack\.com$/.test(c.domain.replace(/^\./, "")) && c.value.startsWith("xoxd-"));
  return d?.value ?? null;
}

export async function browserLogin(opts: { log?: (line: string) => void; timeoutMs?: number } = {}): Promise<string> {
  const log = opts.log ?? (() => {});
  const chrome = findChrome();
  if (!chrome) throw new Error("没找到 Chrome：装一个 Google Chrome 再来，或者用 chief connect slack --stdin 手动贴 Cookie");
  const profile = mkdtempSync(join(tmpdir(), "chief-login-"));
  // 端口给 0，让 Chrome 自己挑一个空的，再从配置目录里的 DevToolsActivePort 读出来；只听本机。
  const proc = spawn(chrome, [
    "--remote-debugging-port=0", "--remote-debugging-address=127.0.0.1", `--user-data-dir=${profile}`,
    "--no-first-run", "--no-default-browser-check", `--app=${SIGNIN_URL}`,
  ], { stdio: "ignore" });
  const closed = new Promise<void>((resolve) => proc.once("exit", () => resolve()));
  let ws: WebSocket | null = null;
  try {
    log("开了一个 Slack 登录窗口：在里面登录，登好会自己关掉。");
    const url = await debuggerUrl(profile, proc);
    ws = await open(url);
    const call = rpc(ws);
    const deadline = Date.now() + (opts.timeoutMs ?? TIMEOUT_MS);
    let tried = "";
    while (Date.now() < deadline) {
      if (proc.exitCode !== null || proc.signalCode !== null) throw new Error("登录窗口被关掉了，没登上");
      const { cookies } = await call<{ cookies?: Cookie[] }>("Storage.getCookies");
      const cookie = slackCookie(cookies ?? []);
      // 同一个 Cookie 只验一次；SSO 跳转中途可能先出现一个还不能用的。
      if (cookie && cookie !== tried) {
        tried = cookie;
        if (await usable(cookie)) return cookie;
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

function rpc(ws: WebSocket): <T>(method: string) => Promise<T> {
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
  return <T>(method: string) => new Promise<T>((resolve, reject) => {
    const id = ++seq;
    waiting.set(id, { resolve: resolve as (v: unknown) => void, reject });
    ws.send(JSON.stringify({ id, method }));
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

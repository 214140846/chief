// 照搬 aide 的 work/src/program.ts。
import { existsSync } from "node:fs";
import { dirname } from "node:path";
// 跑一个外部程序：不经过 shell（参数原样交给程序），只给最少的环境变量，有超时，能取消。
// 取消、超时会把它和它拉起的子进程（npm 跑测试时的那一串）一起结束。
import { spawn } from "node:child_process";

export interface ExecOptions {
  cwd: string;
  timeoutMs: number;
  signal?: AbortSignal;
  // 要连远端（fetch、push）：带上 ssh-agent，git 才能用你的 ssh 钥匙。
  network?: boolean;
  // 输出最多留多少字（留最后这么多）。
  maxOutput?: number;
  env?: Record<string, string>;
}

export interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  aborted: boolean;
}

const DEFAULT_MAX_OUTPUT = 2 * 1024 * 1024;
const KILL_GRACE_MS = 2_000;

// launchd 下 PATH 很短：补上跑引擎的这个 node 所在的目录（npm、yarn、corepack 在这）、~/.local/bin、Homebrew，pnpm 这些才找得到。
export function toolPath(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.HOME ?? "";
  const extra = [dirname(process.execPath), home && `${home}/.local/bin`, home && `${home}/Library/pnpm`, "/opt/homebrew/bin", "/usr/local/bin"].filter((d): d is string => Boolean(d) && existsSync(d));
  const base = (env.PATH ?? "/usr/bin:/bin:/usr/sbin:/sbin").split(":");
  return [...new Set([...extra, ...base])].filter(Boolean).join(":");
}

// 只给这几个。chief 自己的环境变量、钥匙串里的东西都不给。
export function safeEnv(network = false): Record<string, string> {
  const pick = (k: string) => (process.env[k] ? { [k]: process.env[k]! } : {});
  return {
    PATH: toolPath(),
    ...pick("HOME"), ...pick("USER"), ...pick("TMPDIR"),
    LANG: "en_US.UTF-8",
    GIT_TERMINAL_PROMPT: "0",
    ...(network ? pick("SSH_AUTH_SOCK") : {}),
  };
}

export function runProgram(command: string, args: readonly string[], options: ExecOptions): Promise<ExecResult> {
  const max = options.maxOutput ?? DEFAULT_MAX_OUTPUT;
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      resolve({ code: null, stdout: "", stderr: "", timedOut: false, aborted: true });
      return;
    }
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: { ...safeEnv(options.network), ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
      // 自成一组，结束时连子进程一起结束。
      detached: true,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let aborted = false;
    const keep = (buf: string, chunk: Buffer) => {
      const next = buf + chunk.toString("utf8");
      return next.length > max ? next.slice(next.length - max) : next;
    };
    child.stdout.on("data", (c: Buffer) => { stdout = keep(stdout, c); });
    child.stderr.on("data", (c: Buffer) => { stderr = keep(stderr, c); });
    const kill = () => {
      if (child.pid === undefined || child.exitCode !== null) return;
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        // 已经退出了。
      }
      setTimeout(() => {
        try {
          if (child.pid !== undefined && child.exitCode === null) process.kill(-child.pid, "SIGKILL");
        } catch {
          // 已经退出了。
        }
      }, KILL_GRACE_MS).unref();
    };
    const timer = setTimeout(() => { timedOut = true; kill(); }, options.timeoutMs);
    const onAbort = () => { aborted = true; kill(); };
    options.signal?.addEventListener("abort", onAbort, { once: true });
    child.on("error", (error) => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      resolve({ code, stdout, stderr, timedOut, aborted });
    });
  });
}

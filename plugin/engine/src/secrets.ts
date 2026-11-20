// 密钥放在 macOS 钥匙串里，不落盘、不进数据库、不进日志。
// 用系统自带的 security 命令。读：参数里只有名字。写：密钥从标准输入交给 `security -i`，不出现在进程列表里。
import { execFile, spawn } from "node:child_process";
import { userInfo } from "node:os";

const SECURITY = "/usr/bin/security";
// 名字只允许这些字符：拼进 security -i 的命令时不会出问题。
const NAME = /^[a-z0-9_.-]{1,64}$/;
// 值只允许令牌常见的字符，同样为了不破坏命令。% 是因为 Slack 的 cookie 是 URL 编码过的。
const VALUE = /^[A-Za-z0-9._~+/=%_-]{1,4096}$/;
const ACCOUNT = /^[A-Za-z0-9_.-]{1,64}$/;

// 这个值能不能存进钥匙串。设置页在检查之前先用它挡掉粘错的内容。
export function isStorableSecret(value: string): boolean {
  return VALUE.test(value);
}

export interface SecretStore {
  get(name: string): Promise<string | null>;
  // 有没有存。不读出值本身，给设置页显示「已设置 / 未设置」用。
  has(name: string): Promise<boolean>;
  set(name: string, value: string): Promise<void>;
  delete(name: string): Promise<void>;
}

export type Runner = (args: readonly string[], stdin?: string) => Promise<{ code: number; stdout: string; stderr: string }>;

const run: Runner = (args, stdin) => new Promise((resolve) => {
  if (stdin === undefined) {
    execFile(SECURITY, [...args], { timeout: 15_000 }, (error, stdout, stderr) => {
      const code = error ? (typeof (error as { code?: unknown }).code === "number" ? (error as { code: number }).code : 1) : 0;
      resolve({ code, stdout: String(stdout), stderr: String(stderr) });
    });
    return;
  }
  const child = spawn(SECURITY, [...args], { stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
  child.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
  child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  child.stdin.end(stdin);
});

export class KeychainStore implements SecretStore {
  private readonly account: string;

  constructor(private readonly runner: Runner = run, account = userInfo().username) {
    if (!ACCOUNT.test(account)) throw new Error("系统用户名里有不支持的字符");
    this.account = account;
  }

  private service(name: string): string {
    if (!NAME.test(name)) throw new Error(`密钥名字不合法：${name}`);
    return `chief:${name}`;
  }

  async get(name: string): Promise<string | null> {
    const res = await this.runner(["find-generic-password", "-a", this.account, "-s", this.service(name), "-w"]);
    if (res.code !== 0) return null;
    const value = res.stdout.replace(/\n$/, "");
    return value.length > 0 ? value : null;
  }

  async has(name: string): Promise<boolean> {
    // 不带 -w：只查这一项在不在，不把密钥读出来。
    const res = await this.runner(["find-generic-password", "-a", this.account, "-s", this.service(name)]);
    return res.code === 0;
  }

  async set(name: string, value: string): Promise<void> {
    const service = this.service(name);
    if (!VALUE.test(value)) throw new Error("密钥里有不支持的字符");
    // -U：已有就更新。
    const command = `add-generic-password -U -a "${this.account}" -s "${service}" -w "${value}"\n`;
    const res = await this.runner(["-i"], command);
    if (res.code !== 0 || /error/i.test(res.stderr)) throw new Error("写进钥匙串失败");
  }

  async delete(name: string): Promise<void> {
    await this.runner(["delete-generic-password", "-a", this.account, "-s", this.service(name)]);
  }
}

// 测试和不在 Mac 上时用。
export class MemorySecretStore implements SecretStore {
  private readonly values = new Map<string, string>();
  async get(name: string) { return this.values.get(name) ?? null; }
  async has(name: string) { return this.values.has(name); }
  async set(name: string, value: string) { this.values.set(name, value); }
  async delete(name: string) { this.values.delete(name); }
}

// 一个通道的密钥在钥匙串里的名字：<通道>.<密钥名>。
export function channelSecretName(channel: string, name: string): string {
  return `${channel}.${name}`;
}

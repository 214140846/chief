// launchd 跑的入口：就是 chief run。
export {};
process.argv.splice(2, process.argv.length - 2, "run");
await import("./cli");

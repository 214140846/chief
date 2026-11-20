// 按名字找 Slack 上的人，拿到用户编号：稿子里写 <@U…> 对方才会真的收到提醒（只写 @名字 是普通文字）。
// 用 Slack 客户端的人员搜索，只连一下、不收消息，一次一秒左右。
export interface Person {
  id: string;
  name: string;
  title: string;
}

export async function findPeople(cookieD: string, query: string): Promise<Person[]> {
  const { GabrielCore, silentLogger } = await import("gabriel-slack");
  const core = new GabrielCore({ auth: { cookieD }, logger: silentLogger });
  try {
    await core.initialize();
    const res = (await core.callWebApi(
      "search.modules.people",
      { module: "people", query, page: 1, count: 10, search_context: "desktop_people_tab" },
      { reason: "chief-who" },
    )) as { items?: { id?: unknown; deleted?: unknown; is_bot?: unknown; real_name?: unknown; profile?: { real_name?: unknown; display_name?: unknown; title?: unknown } }[] };
    return (res.items ?? []).flatMap((u) => {
      if (typeof u.id !== "string" || !/^[UW][A-Z0-9]{2,20}$/.test(u.id) || u.deleted === true || u.is_bot === true) return [];
      const name = [u.profile?.display_name, u.real_name, u.profile?.real_name].find((x): x is string => typeof x === "string" && x.trim() !== "") ?? u.id;
      return [{ id: u.id, name, title: typeof u.profile?.title === "string" ? u.profile.title : "" }];
    });
  } finally {
    void core.disconnect();
  }
}

// Slack 消息链接 → 频道和那条消息的编号；链接带 thread_ts 的（thread 里某条回复的链接），回到那个 thread 的开头。
// https://x.slack.com/archives/C0123ABC/p1795079290188699?thread_ts=1795079000.000100&cid=C0123ABC
export function parsePermalink(url: string): { channel: string; thread_ts: string } | null {
  const m = /^https:\/\/[\w-]{1,80}\.slack\.com\/archives\/([CGD][A-Z0-9]{2,20})\/p(\d{10})(\d{6})(?:\?(.*))?$/.exec(url.trim());
  if (!m) return null;
  const root = new URLSearchParams(m[4] ?? "").get("thread_ts");
  return { channel: m[1]!, thread_ts: root && /^\d{10}\.\d{6}$/.test(root) ? root : `${m[2]}.${m[3]}` };
}

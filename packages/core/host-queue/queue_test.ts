import assert from "node:assert/strict";
import { test } from "node:test";
import { createIdSource, manualClock, seededRandom } from "../../base/mod.ts";
import type { Id } from "../../protocol/base/ids.ts";
import type {
  HostRequest,
  HostWorkspace,
} from "../../protocol/lophn-agent/host-queue.ts";
import { createHostQueue, type HostQueueService } from "./queue.ts";

const OWNER = "ses_owner" as Id<"ses">;
const OTHER = "ses_other" as Id<"ses">;
const HOME = { kind: "home" } as const;

function setup() {
  const clock = manualClock(1_700_000_000_000);
  const ids = createIdSource({ clock, random: seededRandom(1) });
  return { clock, queue: createHostQueue({ clock, ids }) };
}

// `/host-link` 연결 하나를 붙이고 queue가 밀어 준 요청을 받은 차례로 꺼낸다.
function connect(
  queue: HostQueueService,
  workspaces: readonly HostWorkspace[] = [],
) {
  const sent: HostRequest[] = [];
  const link = queue.connect((request) => sent.push(request));
  link.visible(workspaces);
  return { link, next: () => sent.shift() ?? null };
}

test("다른 session이 연 탭은 닫지도 펴지도 읽지도 못한다", () => {
  const { queue } = setup();
  const tab = queue.openTab({
    owner: OWNER,
    workspace: HOME,
    target: { browser: { url: "https://example.com" } },
    relation: null,
    source: OWNER,
  });
  queue.report(tab, {
    url: "https://example.com/",
    title: "t",
    loading: false,
  });

  const read = queue.read(tab, OTHER);
  assert.equal(!read.ok && read.error.code, "not_found");
  const close = queue.close(tab, OTHER);
  assert.equal(!close.ok && close.error.code, "forbidden");
  assert.equal(queue.close("tab_missing" as Id<"tab">, OWNER).ok, false);
  const show = queue.show(tab, OTHER);
  assert.equal(!show.ok && show.error.code, "forbidden");
  const missing = queue.show("tab_missing" as Id<"tab">, OWNER);
  assert.equal(!missing.ok && missing.error.code, "not_found");

  // 연 session이 펴면 그 tab의 workspace로 tab_show가 나간다.
  assert.equal(queue.show(tab, OWNER).ok, true);
  const host = connect(queue, [HOME]);
  const lent = host.next();
  assert.equal(lent?.kind, "tab_open");
  queue.done(lent!.id as Id<"hrq">, "done");
  const shown = host.next();
  assert.deepStrictEqual(shown?.kind === "tab_show" ? shown.payload : null, {
    tab,
  });

  // 연 session은 읽고 닫는다. 닫으면 표에서 빠져 다시 닫지 못한다.
  assert.equal(queue.read(tab, OWNER).ok, true);
  assert.equal(queue.close(tab, OWNER).ok, true);
  const again = queue.close(tab, OWNER);
  assert.equal(!again.ok && again.error.code, "not_found");
});

test("이미 열린 preview 탭에 기기나 화면을 주면 같은 탭 id로 tab_open이 다시 나간다", () => {
  const { queue } = setup();
  const APP = "app_a" as Id<"app">;
  const open = (device: string | null, screen: string | null = null) =>
    queue.openTab({
      owner: OWNER,
      workspace: { kind: "app", id: APP },
      target: { preview: { app: APP, device, screen } },
      relation: null,
      source: OWNER,
    });
  const host = connect(queue, [{ kind: "app", id: APP }]);
  const tab = open(null);
  queue.done(host.next()!.id as Id<"hrq">, "done");
  assert.equal(open(null), tab);
  assert.equal(host.next(), null);
  assert.equal(open("iPhone"), tab);
  const again = host.next()!;
  assert.equal(again.kind === "tab_open" && again.payload.tab === tab, true);
  queue.done(again.id as Id<"hrq">, "done");
  assert.equal(open(null, "home"), tab);
  const screen = host.next()!;
  assert.equal(screen.kind === "tab_open" && screen.payload.tab === tab, true);
});

// 창이 받지 못한(retry) 탭 요청이 다시 나가지 않으면 그 탭은 열리지 않는다.
test("retry한 요청은 다음 pump에 다시 나간다", () => {
  const { queue } = setup();
  const host = connect(queue, [HOME]);
  queue.openTab({
    owner: OWNER,
    workspace: HOME,
    target: { session: OWNER },
    relation: null,
    source: OWNER,
  });
  const first = host.next()!;
  queue.done(first.id as Id<"hrq">, "retry");
  assert.equal(host.next(), null);
  host.link.pump();
  assert.equal(host.next()?.id, first.id);
});

// 같은 호출을 두 번 실행하면 extension handler의 효과(탭 조작, 결제 같은 외부 일)가 겹친다.
test("tool_call은 workspace 없이 가져가고, 빌려 간 뒤 기한이 지나도 다시 내놓지 않으며, 결과나 abandon으로 끝난다", async () => {
  const { clock, queue } = setup();
  const payload = (tool: string) => ({
    extension: "web",
    tool,
    input: {},
    session: OWNER,
    workspace: HOME,
    credential: "token",
  });

  const host = connect(queue);
  const first = queue.callTool(payload("a"));
  assert.equal(host.next()?.id, first.id);
  clock.advance(60_000);
  host.link.pump();
  assert.equal(host.next(), null, "a borrowed tool call is not lent twice");

  queue.done(first.id, "done", {
    content: [{ type: "text", text: "ok" }],
  });
  const done = await first.result;
  assert.ok(done.ok && done.value[0]?.type === "text");

  // 부른 쪽이 거두면 unavailable로 끝나고 다시 나가지 않는다.
  const second = queue.callTool(payload("b"));
  assert.equal(host.next()?.id, second.id);
  queue.abandon(second.id);
  const gone = await second.result;
  assert.ok(!gone.ok && gone.error.code === "unavailable");
  host.link.pump();
  assert.equal(host.next(), null);

  // 빌려 간 뒤 답이 없으면 5분 뒤 거두고, 늦은 done은 무시된다.
  const third = queue.callTool(payload("c"));
  assert.equal(host.next()?.id, third.id);
  clock.advance(299_000);
  queue.expire();
  clock.advance(2_000);
  queue.expire();
  const timedOut = await third.result;
  assert.ok(!timedOut.ok && timedOut.error.code === "unavailable");
  assert.match(timedOut.error.message, /within 5 minutes/);
  queue.done(third.id, "done", { content: [{ type: "text", text: "late" }] });
});

// 기한을 넘은 browser 호출이 pending에 남으면 shell이 오래 뒤 낡은 click을 실행한다.
test("기한을 넘은 browser_call은 unavailable로 끝나고 pending에서 빠지며 늦은 done은 무시된다", async () => {
  const { clock, queue } = setup();
  const host = connect(queue);
  const call = queue.callBrowser({
    tab: "tab_x" as Id<"tab">,
    view: "browser",
    action: { kind: "snapshot" },
  });
  assert.equal(host.next()?.id, call.id);
  clock.advance(29_000);
  queue.expire();
  clock.advance(2_000);
  queue.expire();

  const late = await call.result;
  assert.ok(!late.ok && late.error.code === "unavailable");
  assert.match(late.error.message, /timed out/);
  host.link.pump();
  assert.equal(host.next(), null);
  queue.done(call.id, "done", { content: [{ type: "text", text: "late" }] });
});

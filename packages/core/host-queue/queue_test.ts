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

// 기한을 넘은 browser 호출이 pending에 남거나 빌려 간 호출이 다시 나가면 shell이 낡은 click을 (두 번) 실행한다.
test("빌려 간 browser_call은 다시 나가지 않고, 기한을 넘으면 unavailable로 끝나 pending에서 빠지며 늦은 done은 무시된다", async () => {
  const { clock, queue } = setup();
  const host = connect(queue);
  const call = queue.callBrowser({
    tab: "tab_x" as Id<"tab">,
    view: "browser",
    action: { kind: "snapshot" },
  });
  assert.equal(host.next()?.id, call.id);
  clock.advance(29_000);
  host.link.pump();
  assert.equal(host.next(), null, "a borrowed call is not lent twice");
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

// 연결 요청이 대기하거나 다음 연결로 다시 가면 멀리서 친 늦은 입력이 다음 host의 page에 들어간다.
test("연결 요청은 연결이 없으면 대기하지 않고 바로 unavailable이고, 연결이 닫히면 거두어 다음 연결로 가지 않는다", async () => {
  const { queue } = setup();
  const input = {
    kind: "page_input",
    payload: {
      tab: "tab_x" as Id<"tab">,
      input: { type: "text", text: "hunter2" },
    },
  } as const;

  const absent = await queue.callLink(input);
  assert.ok(!absent.ok && absent.error.code === "unavailable");

  const first = connect(queue);
  const call = queue.callLink(input);
  assert.equal(first.next()?.kind, "page_input");
  first.link.close();
  const lost = await call;
  assert.ok(!lost.ok && lost.error.code === "unavailable");

  const second = connect(queue);
  assert.equal(second.next(), null);
  // 앞 연결이 없을 때 부른 것도 남지 않았다.
  second.link.pump();
  assert.equal(second.next(), null);
});

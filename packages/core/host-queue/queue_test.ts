import assert from "node:assert/strict";
import { test } from "node:test";
import { createIdSource, manualClock, seededRandom } from "../../base/mod.ts";
import type { Id } from "../../protocol/base/ids.ts";
import { createHostQueue } from "./queue.ts";

const OWNER = "ses_owner" as Id<"ses">;
const OTHER = "ses_other" as Id<"ses">;
const HOME = { kind: "home" } as const;

function setup() {
  const clock = manualClock(1_700_000_000_000);
  const ids = createIdSource({ clock, random: seededRandom(1) });
  return { clock, queue: createHostQueue({ clock, ids }) };
}

test("다른 session이 연 탭은 닫지도 읽지도 못한다", () => {
  const { queue } = setup();
  const tab = queue.openTab({
    owner: OWNER,
    workspace: HOME,
    target: { browser: { url: "https://example.com" } },
    place: null,
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

  // 연 session은 읽고 닫는다. 닫으면 표에서 빠져 다시 닫지 못한다.
  assert.equal(queue.read(tab, OWNER).ok, true);
  assert.equal(queue.close(tab, OWNER).ok, true);
  const again = queue.close(tab, OWNER);
  assert.equal(!again.ok && again.error.code, "not_found");
});

test("retry한 요청은 뒤로 가서 다음 요청을 막지 않는다", () => {
  const { queue } = setup();
  const open = (url: string) =>
    queue.openTab({
      owner: OWNER,
      workspace: HOME,
      target: { browser: { url } },
      place: null,
      source: OWNER,
    });
  open("https://a.example");
  open("https://b.example");

  const first = queue.take([HOME])!;
  queue.done(first.id as Id<"hrq">, "retry");
  const next = queue.take([HOME])!;
  assert.notEqual(next.id, first.id);
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

  const first = queue.callTool(payload("a"));
  const taken = queue.take([]);
  assert.equal(taken?.id, first.id);
  clock.advance(60_000);
  assert.equal(queue.take([]), null, "a borrowed tool call is not lent twice");

  queue.done(first.id, "done", {
    content: [{ type: "text", text: "ok" }],
  });
  const done = await first.result;
  assert.ok(done.ok && done.value[0]?.type === "text");

  // shell이 떨어져 부른 쪽이 거두면 unavailable로 끝나고 다시 가져갈 수 없다.
  const second = queue.callTool(payload("b"));
  queue.abandon(second.id);
  const gone = await second.result;
  assert.ok(!gone.ok && gone.error.code === "unavailable");
  assert.equal(queue.take([]), null);
});

// 기한을 넘은 browser 호출이 pending에 남으면 shell이 오래 뒤 낡은 click을 실행한다.
test("기한을 넘은 browser_call은 unavailable로 끝나고 pending에서 빠지며 늦은 done은 무시된다", async () => {
  const { clock, queue } = setup();
  const call = queue.callBrowser({
    tab: "tab_x" as Id<"tab">,
    view: "browser",
    action: { kind: "snapshot" },
  });
  assert.equal(queue.take([])?.id, call.id);
  clock.advance(29_000);
  queue.expire();
  clock.advance(2_000);
  queue.expire();

  const late = await call.result;
  assert.ok(!late.ok && late.error.code === "unavailable");
  assert.match(late.error.message, /timed out/);
  assert.equal(queue.take([]), null);
  queue.done(call.id, "done", { content: [{ type: "text", text: "late" }] });
});

test("take가 기다리는 동안은 attached이고 기다림이 끝난 뒤 3초가 지나면 아니다", async () => {
  const { clock, queue } = setup();
  assert.equal(queue.attached(), false);
  const waited = queue.wait([HOME]);
  clock.advance(60_000);
  assert.equal(queue.attached(), true);

  // 요청이 들어오면 기다리던 take가 바로 받는다.
  queue.openTab({
    owner: OWNER,
    workspace: HOME,
    target: { browser: { url: "https://example.com" } },
    place: null,
    source: OWNER,
  });
  assert.equal((await waited)?.kind, "tab_open");
  assert.equal(queue.attached(), true);
  clock.advance(3_001);
  assert.equal(queue.attached(), false);
});

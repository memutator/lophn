import assert from "node:assert/strict";
import { test } from "node:test";
import { manualClock, ok } from "../../base/mod.ts";
import type { Id } from "../../protocol/base/ids.ts";
import type { BusEvent } from "../../protocol/events/bus.ts";
import type { LinkRequest } from "../../protocol/lophn-agent/host-queue.ts";
import { PAGE_VIEW_LEASE_MS } from "../../protocol/lophn-agent/page-view.ts";
import type { AuthenticatedContext } from "../../protocol/server/mod.ts";
import { createPageView } from "./page-view.ts";

const flush = () => new Promise((resolve) => setImmediate(resolve));
const TAB = "tab_01hzx3k4m5n6p7q8r9s0t1v2w3" as Id<"tab">;
// 다른 session의 agent가 연 탭이다.
const OTHER = "tab_01hzx3k4m5n6p7q8r9s0t1v2w4" as Id<"tab">;
const SESSION = "ses_01hzx3k4m5n6p7q8r9s0t1v2w5" as Id<"ses">;
const OTHER_SESSION = "ses_01hzx3k4m5n6p7q8r9s0t1v2w6" as Id<"ses">;

const context = (principal: string, actor: string): AuthenticatedContext =>
  ({
    principal,
    actor,
    scope: { operations: [], targets: {} },
    conditions: actor.startsWith("agent:") ? { session: SESSION } : {},
    credential_ref: principal,
  }) as AuthenticatedContext;
const allowed = context("device:yes", "user");
const denied = context("device:no", "user");
// 터미널 입력 허락을 받은 principal이라도 agent 자격이면 막혀야 한다.
const agent = context("device:yes", `agent:${SESSION}`);

const frame = (tab: Id<"tab">, seq: number) => ({
  type: "page_frame" as const,
  tab,
  seq,
  frame: {
    media_type: "image/jpeg" as const,
    data_base64: "AAAA",
    width: 800,
    height: 600,
  },
});

function setup() {
  const clock = manualClock(0);
  const calls: LinkRequest[] = [];
  const opened: string[] = [];
  const published: BusEvent[] = [];
  const grants = new Set(["device:yes"]);
  const view = createPageView({
    clock,
    publish: (event) => published.push(event),
    call: (request) => {
      calls.push(request);
      return Promise.resolve(ok([]));
    },
    pages: () => [
      {
        tab: TAB,
        owner: SESSION,
        state: { url: "https://a.test", title: "A", loading: false },
      },
      {
        tab: OTHER,
        owner: OTHER_SESSION,
        state: { url: "https://b.test", title: "B", loading: false },
      },
    ],
    agentName: () => "Coder",
    mayControl: (principal) => grants.has(principal),
    deviceKind: () => "phone",
    open: (_who, url) => {
      opened.push(url);
      return Promise.resolve(ok({ tab: TAB }));
    },
    redact: (text) => text,
  });
  return { view, clock, calls, opened, published, grants };
}

// 로그인된 browser를 다루는 것은 터미널에 치는 것만큼 센 권한이다. 허락 없는 호출은 host에 닿으면 안 된다.
test("agent 자격과 터미널 입력 허락이 없는 기기는 page에 입력하지 못하고 host에 아무 요청도 가지 않는다", async () => {
  const { view, calls, opened } = setup();
  // 좌표 입력이 lease 없음(conflict)으로 끝나지 않게 두 principal 모두 본다.
  assert.ok((await view.watch(allowed, { tab: TAB, on: true })).ok);
  assert.ok((await view.watch(denied, { tab: TAB, on: true })).ok);
  const before = calls.length;
  const actions = {
    input: (who: AuthenticatedContext) =>
      view.input(who, {
        tab: TAB,
        key: "k1",
        input: { type: "text", text: "secret" },
      }),
    control: (who: AuthenticatedContext) =>
      view.control(who, { tab: TAB, held: true }),
    open: (who: AuthenticatedContext) =>
      view.open(who, { url: "https://evil.test", key: "o1" }),
  };
  for (const [name, run] of Object.entries(actions)) {
    for (const who of [agent, denied]) {
      const done = await run(who);
      assert.ok(
        !done.ok && done.error.code === "forbidden",
        `${name} by ${who.actor} ${who.principal}`,
      );
    }
  }
  assert.equal(calls.length, before);
  assert.deepEqual(opened, []);

  // 허락받은 기기는 넣는다(같은 거절이 모든 호출을 막는 것이 아니다).
  assert.ok((await actions.input(allowed)).ok);
  assert.equal(calls.at(-1)?.kind, "page_input");
});

test("agent 자격은 어느 탭의 frame도 읽지 못한다(다른 session이 연 탭 포함)", async () => {
  const { view } = setup();
  for (const tab of [TAB, OTHER]) {
    await view.watch(allowed, { tab, on: true });
    view.frame(frame(tab, 1));
  }
  assert.ok((view.list(allowed) as { ok: boolean }).ok);

  const list = view.list(agent);
  assert.ok(!list.ok && list.error.code === "forbidden");
  for (const tab of [TAB, OTHER]) {
    const shown = view.snapshot(agent, tab);
    assert.ok(!shown.ok && shown.error.code === "forbidden", tab);
    const watched = await view.watch(agent, { tab, on: true });
    assert.ok(!watched.ok && watched.error.code === "forbidden", tab);
  }
});

// 보는 쪽이 없는데 host가 frame을 계속 만들거나 core가 옛 frame을 들고 있으면 안 된다.
test("마지막 lease가 끝나거나 기한이 지나면 host에 page_stream {on:false}가 가고, lease가 없을 때 온 frame은 남지 않는다", async () => {
  const { view, clock, calls, published } = setup();
  const streams = () =>
    calls.filter((call) => call.kind === "page_stream").map((c) => c.payload);
  const p1 = context("device:p1", "user");
  const p2 = context("device:p2", "user");

  await view.watch(p1, { tab: TAB, on: true });
  await view.watch(p2, { tab: TAB, on: true });
  assert.deepEqual(streams(), [{ tab: TAB, on: true }]);

  // p1이 끄고 p2는 갱신하지 않는다: p1이 끌 때는 아직 p2가 보므로 끄지 않고, p2의 기한이 지나면 끈다.
  await view.watch(p1, { tab: TAB, on: false });
  await flush();
  assert.equal(streams().length, 1);
  clock.advance(PAGE_VIEW_LEASE_MS);
  view.expire();
  await flush();
  assert.deepEqual(streams(), [
    { tab: TAB, on: true },
    { tab: TAB, on: false },
  ]);

  const events = published.length;
  view.frame(frame(TAB, 7));
  assert.equal(published.length, events);
  const shown = view.snapshot(p1, TAB);
  assert.ok(shown.ok && shown.value.frame === null);
  assert.equal(
    calls.some((call) => call.kind === "page_read"),
    false,
  );

  // 다시 보고 마지막 lease를 끄면 끄는 요청이 가고 그 사이의 frame도 지워진다.
  await view.watch(p1, { tab: TAB, on: true });
  view.frame(frame(TAB, 8));
  assert.ok(view.snapshot(p1, TAB).ok);
  await view.watch(p1, { tab: TAB, on: false });
  await flush();
  assert.deepEqual(streams().at(-1), { tab: TAB, on: false });
  const after = view.snapshot(p1, TAB);
  assert.ok(after.ok && after.value.frame === null);
});

// 멀리서 잡은 것이 남으면 보는 쪽이 떠난 뒤(앱을 내림, 연결이 끊김, 기기를 뺌) agent의 act·navigate·evaluate가 누군가 그 page를
// 다시 열어 돌려줄 때까지 conflict다. 화면 없는 기계에서는 돌려줄 화면도 없다.
test("멀리서 잡은 기기의 lease가 끝나면 잡은 것이 풀려 agent의 쓰기 동작이 다시 된다", async () => {
  const { view, clock, calls, grants } = setup();
  const controls = () =>
    calls.filter((call) => call.kind === "page_control").map((c) => c.payload);
  const other = context("device:other", "user");
  grants.add("device:other");

  // 보지 않고는 잡지 못한다(잡은 것이 묶일 lease가 없다).
  const unwatched = await view.control(allowed, { tab: TAB, held: true });
  assert.ok(!unwatched.ok && unwatched.error.code === "conflict");
  assert.deepEqual(controls(), []);

  // 기한: 잡은 기기가 갱신을 멈추면 다음 주기에 놓는다. 다른 기기가 보고 있어도 그렇다.
  await view.watch(allowed, { tab: TAB, on: true });
  await view.watch(other, { tab: TAB, on: true });
  assert.ok((await view.control(allowed, { tab: TAB, held: true })).ok);
  const list = view.list(other);
  assert.ok(list.ok);
  assert.equal(list.value.pages.find((p) => p.tab === TAB)?.held_by, "phone");
  clock.advance(PAGE_VIEW_LEASE_MS - 1);
  await view.watch(other, { tab: TAB, on: true });
  view.expire();
  assert.deepEqual(controls(), [{ tab: TAB, held: true }]);
  clock.advance(1);
  view.expire();
  assert.deepEqual(controls().at(-1), { tab: TAB, held: false });
  const after = view.list(other);
  assert.ok(after.ok && after.value.pages[0]?.held_by === null);

  // 보기를 끔: 바로 놓는다.
  await view.watch(other, { tab: TAB, on: true });
  await view.control(other, { tab: TAB, held: true });
  await view.watch(other, { tab: TAB, on: false });
  assert.deepEqual(controls().at(-1), { tab: TAB, held: false });

  // 명단에서 빠지거나 허락을 거둠: lease가 남아도 다음 주기에 놓는다.
  await view.watch(other, { tab: TAB, on: true });
  await view.control(other, { tab: TAB, held: true });
  const before = controls().length;
  grants.delete("device:other");
  view.expire();
  assert.equal(controls().length, before + 1);
  assert.deepEqual(controls().at(-1), { tab: TAB, held: false });
});

import assert from "node:assert/strict";
import { test } from "node:test";
import type { TurnRequest } from "../../../../../protocol/approvals/turn-request.ts";
import type { ActivationConsent } from "../../../../../protocol/apps/activation/consent.ts";
import { busEventSchema } from "../../../../../protocol/events/mod.ts";
import { createEventClient } from "./client.ts";
import { createFakeSource } from "./fake-source.ts";
import { reactionsOf } from "./reactions.ts";
import { createWaitingStore, inboxKey } from "./waiting-store.ts";

const SES = "ses_01h455vb4pex5v6nkc6gd5fd01";
const TURN = "trn_01h455vb4pex5v6nkc6gd5fd01";
const CALL = "tcl_01h455vb4pex5v6nkc6gd5fd01";
const APP = "app_01h455vb4pex5v6nkc6gd5fd01";
const REL = "rel_01h455vb4pex5v6nkc6gd5fd01";
const AT = "2026-10-16T09:00:00.000Z";
const id = (prefix: string, n: number) =>
  `${prefix}_01h455vb4pex5v6nkc6gd5fd${String(n).padStart(2, "0")}`;

function permission(n: number): TurnRequest {
  return {
    id: id("apr", n),
    session: SES,
    turn: TURN,
    tool_call: CALL,
    subject: { kind: "shell", command: "git push origin main" },
    always_patterns: ["git push *"],
    to_parent: false,
    created_at: AT,
  };
}

function consent(): ActivationConsent {
  return {
    app: APP,
    app_name: "Orders",
    release: REL,
    comparison: {
      previous_release: null,
      first: true,
      added_resources: [],
      added_tools: [],
      loss_steps: [],
    },
    requested_at: AT,
  };
}

// schema를 통과하는 event만 흘린다. 틀린 fixture는 여기서 던진다.
const turnRequestOpened = (n: number) =>
  busEventSchema.parse({
    session: SES,
    type: "TurnRequestOpened",
    at: AT,
    payload: { request: permission(n) },
  });
const turnRequestClosed = (n: number) =>
  busEventSchema.parse({
    session: SES,
    type: "TurnRequestClosed",
    at: AT,
    payload: { request: id("apr", n), outcome: "allow" },
  });
const questionAsked = (n: number) =>
  busEventSchema.parse({
    session: SES,
    type: "QuestionAsked",
    at: AT,
    payload: {
      group: id("qgr", n),
      turn: TURN,
      tool_call: CALL,
      to_parent: false,
    },
  });
const consentRequested = () =>
  busEventSchema.parse({
    type: "ActivationConsentRequested",
    subject: REL,
    at: AT,
    payload: { app: APP, app_name: "Orders", release: REL },
  });

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const ids = (store: ReturnType<typeof createWaitingStore>) =>
  store.get().entries.map((entry) => entry.id);

test("이미 확인된 조건으로 새로 붙는 구독자는 다른 watch의 ready가 늦거나 빠졌어도 바로 ready를 받는다", async () => {
  const listeners = new Set<(message: { kind: "ready" | "closed" }) => void>();
  let watches = 0;
  const client = createEventClient({
    subscribe: () => () => {},
    call: () => Promise.resolve({ ok: true, value: {} }),
    watch: () => {
      watches += 1;
      return Promise.resolve();
    },
    onEvent: (fn) => {
      const wrapped = fn as (message: { kind: "ready" | "closed" }) => void;
      listeners.add(wrapped);
      return () => {
        listeners.delete(wrapped);
      };
    },
  });

  let firstReady = 0;
  const stopA = client.subscribe({ types: ["StateChanged"] }, (msg) => {
    if (msg.kind === "ready") firstReady += 1;
  });
  await settle();
  assert.equal(watches, 1);
  for (const fn of listeners) fn({ kind: "ready" });
  assert.equal(firstReady, 1);

  // 다른 조건의 watch가 나갔지만 아직 ready가 안 온(또는 유실된) 상태.
  const stopB = client.subscribe({ types: ["WorkflowRenamed"] }, () => {});
  await settle();
  assert.equal(watches, 2);

  // 이미 확인된 StateChanged로 새 구독자(예: WorkflowPanel)가 붙으면 막히지 않고 바로 ready를 받아야 한다.
  let lateReady = 0;
  const stopC = client.subscribe({ types: ["StateChanged"] }, (msg) => {
    if (msg.kind === "ready") lateReady += 1;
  });
  await settle();
  assert.equal(lateReady, 1);
  // 조건이 안 바뀌는 구독 해제에서는 watch를 다시 보내지 않는다.
  stopC();
  await settle();
  assert.equal(watches, 2);

  stopB();
  stopA();
});

test("다시 붙으면 snapshot이 대기 목록을 맞추고 사라진 요청은 남지 않는다", async () => {
  const source = createFakeSource({
    snapshots: [
      {
        session: SES,
        agent: "lophn_home",
        workspace: null,
        spawned_by: null,
        runs_on: null,
        state: "waiting",
        turn_requests: [permission(1)],
        questions: [],
      },
    ],
    consents: [consent()],
  });
  const store = createWaitingStore(
    createEventClient(source),
    () => "2026-10-16T09:00:01.000Z",
    null,
  );
  const stop = store.start();
  await settle();
  assert.deepStrictEqual(ids(store), [id("apr", 1), REL]);

  // 같은 event를 두 번 받아도 항목은 하나다.
  source.emitEvent(turnRequestOpened(3));
  source.emitEvent(turnRequestOpened(3));
  source.emitEvent(consentRequested());
  source.emitEvent(questionAsked(4));
  await settle();
  assert.deepStrictEqual(store.get().count, 4);

  // 끊긴 사이 1번과 동의는 해결됐다. 다시 붙을 때 읽은 snapshot이 목록을 통째로 맞춘다.
  source.disconnect();
  source.reconnect({
    snapshots: [
      {
        session: SES,
        agent: "lophn_home",
        workspace: null,
        spawned_by: null,
        runs_on: null,
        state: "waiting",
        turn_requests: [permission(3)],
        questions: [
          {
            group: id("qgr", 4),
            turn: TURN,
            tool_call: CALL,
            to_parent: false,
          },
        ],
      },
    ],
    consents: [],
  });
  // snapshot을 읽는 동안 온 event는 맞춘 뒤에 적용된다.
  source.emitEvent(turnRequestOpened(5));
  source.emitEvent(turnRequestClosed(3));
  await settle();
  assert.deepStrictEqual(ids(store), [id("qgr", 4), id("apr", 5)]);
  assert.deepStrictEqual(
    store.get().entries.map((entry) => entry.kind),
    ["question", "permission"],
  );

  // snapshot으로 들어온 것은 toast를 만들지 않고 live event는 만든다.
  assert.deepStrictEqual(reactionsOf(consentRequested(), "snapshot"), []);
  assert.deepStrictEqual(reactionsOf(consentRequested(), "live").length, 1);
  stop();
});

test("팀 자식의 요청과 질문(to_parent)은 사람의 대기 목록에 카드로 서지 않는다", async () => {
  const toParent = { ...permission(7), to_parent: true };
  const source = createFakeSource({
    snapshots: [
      {
        session: SES,
        agent: "lophn_home",
        workspace: null,
        spawned_by: null,
        runs_on: null,
        state: "waiting",
        turn_requests: [toParent, permission(8)],
        questions: [
          { group: id("qgr", 9), turn: TURN, tool_call: CALL, to_parent: true },
        ],
      },
    ],
    consents: [],
  });
  const store = createWaitingStore(
    createEventClient(source),
    () => "2026-10-16T09:00:01.000Z",
    null,
  );
  const stop = store.start();
  await settle();
  source.emitEvent(
    busEventSchema.parse({
      session: SES,
      type: "TurnRequestOpened",
      at: AT,
      payload: { request: { ...permission(10), to_parent: true } },
    }),
  );
  source.emitEvent(
    busEventSchema.parse({
      session: SES,
      type: "QuestionAsked",
      at: AT,
      payload: {
        group: id("qgr", 11),
        turn: TURN,
        tool_call: CALL,
        to_parent: true,
      },
    }),
  );
  await settle();
  assert.deepStrictEqual(ids(store), [id("apr", 8)]);
  stop();
});

test("watch 실패와 starting 전이는 pendingWatches·sentKey를 오염시키지 않고 새 session 구독자가 ready를 받는다", async () => {
  const listeners = new Set<(message: { kind: "ready" | "closed" }) => void>();
  const stateListeners = new Set<
    (state: { state: "starting" | "ready" | "stale"; confirmedAt: number | null }) => void
  >();
  let failNext = false;
  let watches = 0;
  const client = createEventClient({
    subscribe: (fn) => {
      stateListeners.add(fn);
      return () => {
        stateListeners.delete(fn);
      };
    },
    call: () => Promise.resolve({ ok: true, value: {} }),
    watch: () => {
      watches += 1;
      if (failNext) {
        failNext = false;
        return Promise.reject(new Error("remote watch failed"));
      }
      return Promise.resolve();
    },
    onEvent: (fn) => {
      const wrapped = fn as (message: { kind: "ready" | "closed" }) => void;
      listeners.add(wrapped);
      return () => {
        listeners.delete(wrapped);
      };
    },
  });

  const stopBase = client.subscribe({ types: ["StateChanged"] }, () => {});
  await settle();
  for (const fn of listeners) fn({ kind: "ready" });

  // 중간 watch 호출이 실패해도 pendingWatches에 유령 항목이 남지 않고 sentKey도 풀려야 한다.
  failNext = true;
  let acpReady = 0;
  const stopAcp = client.subscribe(
    { session: SES, types: ["AcpUpdated"] },
    (msg) => {
      if (msg.kind === "ready") acpReady += 1;
    },
  );
  await settle();
  assert.equal(watches, 2);
  assert.equal(acpReady, 0);

  // 같은 조건으로 다시 붙을 때 sentKey가 풀려 있어 watch가 다시 나가고, ready를 받는다.
  const stopAcp2 = client.subscribe(
    { session: SES, types: ["AcpUpdated"] },
    (msg) => {
      if (msg.kind === "ready") acpReady += 1;
    },
  );
  await settle();
  assert.equal(watches, 3);
  for (const fn of listeners) fn({ kind: "ready" });
  assert.equal(acpReady, 2);

  // 원격 link가 connected→connecting("starting")으로 내려가면 disconnected가 오고, 재연결 ready에서 다시 동기화된다.
  let disconnected = 0;
  const stopWatchDisconnect = client.subscribe(
    { types: ["NoticeClosed"] },
    (msg) => {
      if (msg.kind === "disconnected") disconnected += 1;
    },
  );
  await settle();
  for (const fn of stateListeners) fn({ state: "starting", confirmedAt: null });
  assert.equal(disconnected, 1);

  stopWatchDisconnect();
  stopAcp2();
  stopAcp();
  stopBase();
});

test("합친 Inbox의 key는 기계를 붙여 같은 앱 id의 동의가 두 기계에서 하나로 접히지 않는다", () => {
  assert.notEqual(inboxKey(null, REL), inboxKey("mch_other", REL));
  assert.notEqual(inboxKey("mch_a", APP), inboxKey("mch_b", APP));
});

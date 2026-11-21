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

test("다시 붙으면 snapshot이 대기 목록을 맞추고 사라진 요청은 남지 않는다", async () => {
  const source = createFakeSource({
    snapshots: [
      {
        session: SES,
        agent: "lophn_home",
        workspace: null,
        spawned_by: null,
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

test("합친 Inbox의 key는 기계를 붙여 같은 앱 id의 동의가 두 기계에서 하나로 접히지 않는다", () => {
  assert.notEqual(inboxKey(null, REL), inboxKey("mch_other", REL));
  assert.notEqual(inboxKey("mch_a", APP), inboxKey("mch_b", APP));
});

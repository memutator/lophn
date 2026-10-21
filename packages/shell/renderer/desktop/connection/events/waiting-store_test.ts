import { assertEquals } from "@std/assert";
import type {
  PendingApproval,
  TurnPermissionRequest,
} from "../../../../../protocol/approvals/mod.ts";
import { busEventSchema } from "../../../../../protocol/events/mod.ts";
import { createEventClient } from "./client.ts";
import { createFakeSource } from "./fake-source.ts";
import { reactionsOf } from "./reactions.ts";
import { createWaitingStore } from "./waiting-store.ts";

const SES = "ses_01h455vb4pex5v6nkc6gd5fd01";
const TURN = "trn_01h455vb4pex5v6nkc6gd5fd01";
const CALL = "tcl_01h455vb4pex5v6nkc6gd5fd01";
const APP = "app_01h455vb4pex5v6nkc6gd5fd01";
const REL = "rel_01h455vb4pex5v6nkc6gd5fd01";
const AT = "2026-10-16T09:00:00.000Z";
const id = (prefix: string, n: number) =>
  `${prefix}_01h455vb4pex5v6nkc6gd5fd${String(n).padStart(2, "0")}`;

function permission(n: number): TurnPermissionRequest {
  return {
    id: id("apr", n),
    session: SES,
    turn: TURN,
    tool_call: CALL,
    intent: {
      kind: "app_tool",
      actor: { kind: "agent", agent: { role: "lophn" }, session: SES },
      target: { kind: "app_tool", app: APP, tool: "orders.list" },
      effect: "read",
      input: {},
      origin: { kind: "turn", session: SES, turn: TURN, tool_call: CALL },
    },
    choices: ["once", "reject"],
    fingerprint: "0".repeat(64),
    created_at: AT,
  };
}

function activation(n: number): PendingApproval {
  return {
    id: id("apr", n),
    intent: {
      kind: "activation",
      actor: { kind: "program", seq: "1" },
      target: { kind: "activation", app: APP, release: REL },
      effect: "read",
      input: {
        previous_release: null,
        first: true,
        added_resources: [],
        added_tools: [],
        loss_steps: [],
      },
      origin: { kind: "activation", app: APP, release: REL },
    },
    choices: ["allow", "reject"],
    status: "pending",
    reject_reason: null,
    applied: null,
    created_seq: "1",
    decided_seq: null,
    created_at: AT,
    decided_at: null,
  };
}

// schema를 통과하는 event만 흘린다. 틀린 fixture는 여기서 던진다.
const permissionRequested = (n: number) =>
  busEventSchema.parse({
    session: SES,
    type: "PermissionRequested",
    at: AT,
    payload: { request: permission(n) },
  });
const permissionResolved = (n: number) =>
  busEventSchema.parse({
    session: SES,
    type: "PermissionResolved",
    at: AT,
    payload: { request: id("apr", n), outcome: "allow" },
  });
const questionAsked = (n: number) =>
  busEventSchema.parse({
    session: SES,
    type: "QuestionAsked",
    at: AT,
    payload: { group: id("qgr", n), turn: TURN, tool_call: CALL },
  });
const approvalRequested = (n: number) =>
  busEventSchema.parse({
    type: "ApprovalRequested",
    subject: id("apr", n),
    at: AT,
    payload: { request: activation(n) },
  });

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const ids = (store: ReturnType<typeof createWaitingStore>) =>
  store.get().entries.map((entry) => entry.id);

Deno.test("다시 붙으면 snapshot이 대기 목록을 맞추고 사라진 요청은 남지 않는다", async () => {
  const source = createFakeSource({
    snapshots: [{
      session: SES,
      agent: { role: "lophn" },
      place: null,
      state: "waiting",
      permission_requests: [permission(1)],
      turn_requests: [],
      questions: [],
    }],
    approvals: [activation(2)],
  });
  const store = createWaitingStore(
    createEventClient(source),
    () => "2026-10-16T09:00:01.000Z",
    null,
    { set: setTimeout, clear: clearTimeout },
  );
  const stop = store.start();
  await settle();
  assertEquals(ids(store), [id("apr", 1), id("apr", 2)]);

  // 같은 event를 두 번 받아도 항목은 하나다.
  source.emitEvent(permissionRequested(3));
  source.emitEvent(permissionRequested(3));
  source.emitEvent(approvalRequested(2));
  source.emitEvent(questionAsked(4));
  assertEquals(store.get().count, 4);

  // 끊긴 사이 1·2번은 해결됐다. 다시 붙을 때 읽은 snapshot이 목록을 통째로 맞춘다.
  source.disconnect();
  source.reconnect({
    snapshots: [{
      session: SES,
      agent: { role: "lophn" },
      place: null,
      state: "waiting",
      permission_requests: [permission(3)],
      turn_requests: [],
      questions: [{ group: id("qgr", 4), turn: TURN, tool_call: CALL }],
    }],
    approvals: [],
  });
  // snapshot을 읽는 동안 온 event는 맞춘 뒤에 적용된다.
  source.emitEvent(permissionRequested(5));
  source.emitEvent(permissionResolved(3));
  await settle();
  assertEquals(ids(store), [id("qgr", 4), id("apr", 5)]);
  assertEquals(
    store.get().entries.map((entry) => entry.kind),
    ["question", "permission"],
  );

  // snapshot으로 들어온 것은 toast를 만들지 않고 live event는 만든다.
  assertEquals(reactionsOf(permissionRequested(3), "snapshot"), []);
  assertEquals(reactionsOf(permissionRequested(3), "live").length, 1);
  stop();
});

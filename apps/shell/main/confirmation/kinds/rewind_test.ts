import assert from "node:assert/strict";
import { test } from "node:test";

import { contentBasis } from "../handle.ts";
import { createKinds } from "./mod.ts";
import {
  newRevertId,
  readRewind,
  REWIND,
  REWIND_CONCERN,
  rewindState,
  submitRewind,
} from "./rewind.ts";
import { fakeCore, handle, id, ok } from "./kinds_fixture.ts";

const SES = id("ses", 1);
const MSG = id("msg", 1);
const TCL = id("tcl", 1);
const MCL = id("mcl", 1);
const HASH = "p".repeat(64);

type Choice = "restore_all" | "messages_only" | "summarize";

function intent(choice: Choice, targets: string[] = [SES, MSG]) {
  return {
    kind: "owner_decision" as const,
    concern: REWIND_CONCERN,
    decision: REWIND,
    targets,
    choice,
  };
}

const file = (n: number, over: Record<string, unknown> = {}) => ({
  ordinal: n,
  class: "file",
  target: `notes/${n}.md`,
  source: [TCL],
  plan: "restore",
  reason: null,
  app_revert: null,
  ...over,
});

// app_revert 근거에는 receipt 원문이 들어 있다. 창은 그것을 받지 않는다.
const app = {
  ordinal: 5,
  class: "app",
  target: TCL,
  source: [TCL],
  plan: "restore",
  reason: null,
  app_revert: {
    app: id("app", 1),
    release: id("rel", 1),
    command: "ticket.update",
    tool_call: TCL,
    invocation: id("inv", 1),
    receipt: "SECRET-RECEIPT",
    expected_revision: "7",
    revert_command: "ticket.revert",
    step_key: "k",
    revert_invocation: null,
  },
};

function preview(
  over: {
    restore?: unknown[];
    skip?: unknown[];
    remain?: unknown[];
    redo?: boolean;
    hash?: string;
  } = {},
) {
  return () =>
    ok({
      kind: "rewind",
      choice: "restore_all",
      checkpoint: MSG,
      tool_call: null,
      restore: over.restore ?? [file(0)],
      skip: over.skip ?? [],
      remain: over.remain ?? [],
      redo: over.redo ?? true,
      preview_hash: over.hash ?? HASH,
      as_of_seq: "9",
      next_cursor: null,
    });
}

let serial = 0;
const state = () => rewindState(() => id("rvt", ++serial));

test("lophn-agent/revert#R3, shell/confirmation-window#R2: 정본은 preview를 독립 read해 복원할 것·건너뛰는 것·남는 영향을 이유와 함께 보이고 receipt 원문은 싣지 않는다", async () => {
  const fake = fakeCore({
    "read:rewind/preview": preview({
      restore: [file(0), app],
      skip: [file(1, {
        plan: "skip",
        reason: "edited_outside",
      })],
      remain: [{
        ordinal: 6,
        class: "fact",
        target: "external_request",
        source: [TCL],
        plan: "remain",
        reason: "external_effect",
        app_revert: null,
      }],
      redo: false,
    }),
  });
  const read = await readRewind(fake, state(), "cfw_1", intent("restore_all"));
  assert.equal(read.ok, true);
  if (!read.ok) return;
  assert.deepEqual(fake.calls, [{
    kind: "read",
    resource: "rewind",
    method: "preview",
    body: {
      kind: "rewind",
      session: SES,
      checkpoint: MSG,
      choice: "restore_all",
    },
  }]);
  assert.deepEqual(read.value.view, {
    kind: "rewind",
    choice: "restore_all",
    redo: false,
    restore: [
      { class: "file", target: "notes/0.md", reason: null },
      { class: "app", target: TCL, reason: null },
    ],
    skip: [{ class: "file", target: "notes/1.md", reason: "edited_outside" }],
    remain: [{
      class: "fact",
      target: "external_request",
      reason: "external_effect",
    }],
  });
  assert.equal(JSON.stringify(read.value).includes("SECRET-RECEIPT"), false);
});

test("lophn-agent/revert#R7, shell/confirmation-window#R2: 건너뜀·남는 영향이 있으면 accept_remaining=true로 묶고 2차 확인을 두며, 없으면 false이고 2차 확인이 없다", async () => {
  const revert = state();
  const left = await readRewind(
    fakeCore({
      "read:rewind/preview": preview({
        skip: [file(1, { plan: "skip", reason: "link_path" })],
      }),
    }),
    revert,
    "cfw_1",
    intent("restore_all"),
  );
  assert.equal(left.ok, true);
  if (!left.ok) return;
  const content = left.value.content as Record<string, unknown>;
  // handle은 Rewind의 binding 여섯 칸에만 묶이고 대상은 revert id다.
  assert.deepEqual(Object.keys(content).sort(), [
    "accept_remaining",
    "checkpoint",
    "choice",
    "id",
    "preview_hash",
    "session",
  ]);
  assert.equal(left.value.targetRef, content.id);
  assert.equal(content.accept_remaining, true);
  assert.equal(content.preview_hash, HASH);
  assert.equal(left.value.secondConfirm, true);
  assert.deepEqual(left.value.allowed, [REWIND]);
  assert.deepEqual(left.value.request, {
    kind: "owner_decision",
    concern: REWIND_CONCERN,
    decision: REWIND,
    targets: [SES, MSG],
    input: { kind: "inline", value: content },
    comparison: { preview_hash: HASH },
  });

  const clean = await readRewind(
    fakeCore({ "read:rewind/preview": preview() }),
    revert,
    "cfw_2",
    intent("restore_all"),
  );
  assert.equal(clean.ok, true);
  if (!clean.ok) return;
  assert.equal(
    (clean.value.content as Record<string, unknown>).accept_remaining,
    false,
  );
  assert.equal(clean.value.secondConfirm, false);
});

test("lophn-agent/revert#R8: 같은 창의 다시 읽기는 같은 revert id를, 다른 창은 다른 id를 쓰고 창이 닫히면 잊는다", async () => {
  const revert = state();
  const read = (window: string) =>
    readRewind(
      fakeCore({ "read:rewind/preview": preview() }),
      revert,
      window,
      intent("messages_only"),
    );
  const first = await read("cfw_1");
  const again = await read("cfw_1");
  const other = await read("cfw_2");
  const idOf = (value: Awaited<ReturnType<typeof read>>) =>
    value.ok ? (value.value.content as { id: string }).id : "";
  assert.equal(idOf(first), idOf(again));
  assert.notEqual(idOf(first), idOf(other));
  revert.forget("cfw_1");
  assert.notEqual(idOf(await read("cfw_1")), idOf(first));
});

test("lophn-agent/revert#R12, #R15: summarize는 끝난 요약 call이 대상에 있을 때만 결정을 고를 수 있고 그 call은 binding 밖이다", async () => {
  const without = await readRewind(
    fakeCore({ "read:rewind/preview": preview({ restore: [] }) }),
    state(),
    "cfw_1",
    intent("summarize"),
  );
  assert.equal(without.ok && without.value.allowed.length, 0);
  const given = await readRewind(
    fakeCore({ "read:rewind/preview": preview({ restore: [] }) }),
    state(),
    "cfw_1",
    intent("summarize", [SES, MSG, MCL]),
  );
  assert.equal(given.ok, true);
  if (!given.ok) return;
  assert.deepEqual(given.value.allowed, [REWIND]);
  assert.equal(
    "summary_call" in (given.value.content as Record<string, unknown>),
    false,
  );
  assert.deepEqual((given.value.request as { targets: string[] }).targets, [
    SES,
    MSG,
    MCL,
  ]);
});

test("lophn-agent/revert#R15: 숨긴 구간 안 checkpoint나 없는 session은 preview가 거절해 정본을 만들지 못한다", async () => {
  const refused = await readRewind(
    fakeCore({
      "read:rewind/preview": () => ({
        ok: false,
        error: { code: "invalid_input", message: "hidden" },
      }),
    }),
    state(),
    "cfw_1",
    intent("restore_all"),
  );
  assert.equal(refused.ok, false);
  const wrong = await readRewind(
    fakeCore({ "read:rewind/preview": preview() }),
    state(),
    "cfw_1",
    { ...intent("restore_all"), targets: [SES] },
  );
  assert.equal(wrong.ok, false);
});

function content(over: Record<string, unknown> = {}) {
  return {
    id: id("rvt", 1),
    session: SES,
    checkpoint: MSG,
    choice: "restore_all",
    accept_remaining: false,
    preview_hash: HASH,
    ...over,
  };
}

test("lophn-agent/revert#R2, #R7: 제출은 정본 그대로 Rewind를 handle과 compare와 함께 보내고 파일 준비는 core에 맡긴다", async () => {
  const fake = fakeCore({
    "command:rewind/apply": () =>
      ok({
        id: id("rvt", 1),
        session: SES,
        kind: "rewind",
        outcome: "applied",
        redo: "available",
        result_seq: "12",
        replayed: false,
      }),
  });
  const given = handle();
  const sent = await submitRewind(fake, {
    handle: given,
    content: content({ accept_remaining: true }),
    summaryCall: null,
  });
  assert.deepEqual(sent, {
    ok: true,
    value: {
      receipt: { kind: "entity", id: id("rvt", 1) },
      result: "applied",
    },
  });
  assert.deepEqual(fake.calls, [{
    kind: "command",
    resource: "rewind",
    method: "apply",
    body: {
      input: {
        ...content({ accept_remaining: true }),
        summary_call: null,
        files: [],
      },
      idempotency_key: `confirmation:${given.ref}`,
      compare: {
        session_state: "open",
        active_run: null,
        applying_revert: null,
      },
      prepared: [],
      confirmation: given.ref,
    },
  }]);
});

test("lophn-agent/revert#R15: summarize 제출은 끝난 요약 call을 싣고 파일은 싣지 않는다", async () => {
  const fake = fakeCore({
    "command:rewind/apply": () =>
      ok({
        id: id("rvt", 1),
        session: SES,
        kind: "rewind",
        outcome: "applied",
        redo: "none",
        result_seq: "12",
        replayed: false,
      }),
  });
  await submitRewind(fake, {
    handle: handle(),
    content: content({ choice: "summarize" }),
    summaryCall: MCL,
  });
  const body = fake.calls[0]!.body as { input: Record<string, unknown> };
  assert.equal(body.input.summary_call, MCL);
  assert.deepEqual(body.input.files, []);
});

test("lophn-agent/revert#R10, #R11: 앱 단계가 있어 applying으로 접수되면 같은 revert를 RunAppRevert로 이어 실행하고 끝낸 실제 결과를 돌려준다", async () => {
  const fake = fakeCore({
    "command:rewind/apply": () =>
      ok({
        id: id("rvt", 1),
        session: SES,
        kind: "rewind",
        outcome: "applying",
        redo: "none",
        result_seq: null,
        replayed: false,
      }),
    "memory:rewind/run-apps": () =>
      ok({ revert: id("rvt", 1), outcome: "partial", called: ["a"] }),
  });
  const sent = await submitRewind(fake, {
    handle: handle(),
    content: content({ accept_remaining: true }),
    summaryCall: null,
  });
  assert.deepEqual(sent, {
    ok: true,
    value: {
      receipt: { kind: "entity", id: id("rvt", 1) },
      result: "partial",
    },
  });
  assert.deepEqual(fake.calls.map((call) => call.method), [
    "apply",
    "run-apps",
  ]);
  assert.deepEqual(fake.calls[1]!.body, { revert: id("rvt", 1), files: [] });
});

test("lophn-agent/revert#R11: 이어 실행이 닿지 못해도 접수는 남아 있으므로 applying 그대로 알린다", async () => {
  const fake = fakeCore({
    "command:rewind/apply": () =>
      ok({
        id: id("rvt", 1),
        session: SES,
        kind: "rewind",
        outcome: "applying",
        redo: "none",
        result_seq: null,
        replayed: false,
      }),
    "memory:rewind/run-apps": () => ({
      ok: false,
      error: { code: "unavailable", message: "down" },
    }),
  });
  const sent = await submitRewind(fake, {
    handle: handle(),
    content: content(),
    summaryCall: null,
  });
  assert.equal(sent.ok && sent.value.result, "applying");
});

test("lophn-agent/revert#R7: 사람이 본 목록이 바뀌었으면 core가 blocked로 기록한다고 알린다", async () => {
  const fake = fakeCore({
    "command:rewind/apply": () =>
      ok({
        id: id("rvt", 1),
        session: SES,
        kind: "rewind",
        outcome: "blocked",
        redo: "none",
        result_seq: "12",
        replayed: false,
      }),
  });
  const sent = await submitRewind(fake, {
    handle: handle(),
    content: content(),
    summaryCall: null,
  });
  assert.equal(sent.ok && sent.value.result, "blocked");
});

test("lophn-agent/revert#R15: 실행 중인 work가 있으면 core의 conflict를 그대로 돌려주고 결과를 모르면 receipt만 다시 본다", async () => {
  const busy = await submitRewind(
    fakeCore({
      "command:rewind/apply": () => ({
        ok: false,
        error: { code: "conflict", message: "active run" },
      }),
    }),
    { handle: handle(), content: content(), summaryCall: null },
  );
  assert.equal(!busy.ok && !busy.unknown && busy.error.code, "conflict");
  const lost = await submitRewind(
    fakeCore({
      "command:rewind/apply": () => ({
        ok: false,
        error: { code: "unavailable", message: "gone" },
      }),
    }),
    { handle: handle(), content: content(), summaryCall: null },
  );
  assert.equal(!lost.ok && lost.unknown, true);
});

test("shell/confirmation-window#R4: kinds는 lophn-agent/revert의 Rewind를 이 종류로 읽고 Rewind만 보내며, 창이 닫히면 revert id를 잊는다", async () => {
  const fake = fakeCore({
    "read:rewind/preview": preview(),
    "command:rewind/apply": () =>
      ok({
        id: "x",
        session: SES,
        kind: "rewind",
        outcome: "applied",
        redo: "available",
        result_seq: "12",
        replayed: false,
      }),
  });
  const kinds = createKinds({
    core: () => fake,
    clock: { now: () => 1_000 },
    random: (bytes) => bytes,
  });
  const read = await kinds.canon.read(intent("restore_all"), "cfw_1");
  assert.equal(read.ok, true);
  if (!read.ok) return;
  assert.equal(read.value.view?.kind, "rewind");
  const refused = await kinds.submit.submit({
    handle: handle("cfw_1"),
    decision: "ApplyProblemDecision",
    commandInput: {},
    canonical: read.value,
  });
  assert.equal(refused.ok, false);
  const sent = await kinds.submit.submit({
    handle: handle("cfw_1"),
    decision: REWIND,
    commandInput: {},
    canonical: read.value,
  });
  assert.equal(sent.ok && sent.value !== undefined, true);
  const first = (read.value.content as { id: string }).id;
  kinds.closed("cfw_1");
  const again = await kinds.canon.read(intent("restore_all"), "cfw_1");
  assert.notEqual(again.ok && (again.value.content as { id: string }).id, first);
});

test("lophn-agent/revert#R8: revert id는 rvt_ 뒤에 26글자 ULID다", () => {
  const made = newRevertId(1_700_000_000_000, (bytes) => bytes.fill(7));
  assert.match(made, /^rvt_[0-9a-hjkmnp-tv-z]{26}$/);
  assert.equal(contentBasis({ a: 1 }).length, 64);
});

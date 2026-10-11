import assert from "node:assert/strict";
import { test } from "node:test";

import { contentBasis } from "../handle.ts";
import {
  CANCEL,
  GRANT,
  readApproval,
  REJECT,
  submitApproval,
} from "./approval.ts";
import { fakeCore, handle, id, ok } from "./kinds_fixture.ts";
import { createKinds } from "./mod.ts";

const APR = id("apr", 1);
const DOC = id("doc", 1);
const BINDING = "b".repeat(64);

function pending(status = "pending") {
  return {
    request: {
      id: APR,
      requester: "agent:asg_01arz3ndektsv4rrffq69g5fav",
      run: null,
      reason_blob: "1".repeat(64),
      effect: {
        changes_blob: "2".repeat(64),
        external_blob: null,
        reversible: true,
        reversibility_blob: "3".repeat(64),
      },
      action: {
        concern: "documents/addressing",
        command: "document.rename",
        caller: "agent:asg_01arz3ndektsv4rrffq69g5fav",
        targets: [DOC],
        input: { kind: "inline", value: { name: "plan.md" } },
        input_hash: "4".repeat(64),
        comparison: { base_revision: "7" },
        binding_hash: BINDING,
      },
      expires_at: null,
      status,
      closed_reason_blob: null,
      created_seq: "12",
      closed_seq: status === "pending" ? null : "13",
    },
    use: null,
  };
}

const TEXT = {
  approval: APR,
  reason: "The file name no longer matches its title.",
  changes: "Rename notes/a.md to notes/plan.md.",
  external: null,
  reversibility: "Rename it back from the document menu.",
  closed_reason: null,
};

test("shell/confirmation-window#R2, platform/approvals#R1, platform/approvals#R17: approval 창은 결정과 정확한 동작·대상·입력·영향·되돌릴 범위를 정본에서 보인다", async () => {
  const core = fakeCore({
    "read:approvals/get": () => ok(pending()),
    "read:approvals/text": () => ok(TEXT),
  });
  const read = await readApproval(core, APR);
  assert.equal(read.ok, true);
  if (!read.ok) return;
  const view = read.value.view!;
  assert.equal(view.kind, "approval");
  assert.equal(view.concern, "documents/addressing");
  assert.equal(view.command, "document.rename");
  assert.deepEqual(view.targets, [DOC]);
  assert.deepEqual(view.input, {
    kind: "inline",
    value: { name: "plan.md" },
  });
  assert.deepEqual(view.comparison, { base_revision: "7" });
  assert.equal(view.changes, TEXT.changes);
  assert.equal(view.reversible, true);
  assert.equal(view.reversibility, TEXT.reversibility);
  assert.deepEqual(read.value.allowed, [GRANT, REJECT, CANCEL]);
  // handle은 grant·reject binding(approval·created_seq·binding_hash)에 묶인다.
  assert.equal(read.value.targetRef, APR);
  assert.equal(
    contentBasis(read.value.content),
    contentBasis({ approval: APR, created_seq: "12", binding_hash: BINDING }),
  );
  assert.deepEqual(read.value.request, {
    kind: "approval_request",
    approval: APR,
    created_seq: "12",
    binding_hash: BINDING,
  });
});

test("shell/confirmation-window#R5: 끝난 요청이나 설명 글 하나라도 못 읽으면 고를 결정이 없다", async () => {
  const closed = await readApproval(
    fakeCore({
      "read:approvals/get": () => ok(pending("granted")),
      "read:approvals/text": () => ok(TEXT),
    }),
    APR,
  );
  assert.equal(closed.ok, false);
  const missing = await readApproval(
    fakeCore({
      "read:approvals/get": () => ok(pending()),
      "read:approvals/text": () => ({
        ok: false,
        error: { code: "unavailable", message: "blob" },
      }),
    }),
    APR,
  );
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.error.code, "unavailable");
});

test("platform/approvals#R9, platform/approvals#R13, platform/approvals#R14: 허락은 접수로 돌려주고, 거절 이유는 binding 밖 글 값이고, 명시 취소는 handle 없이 보낸다", async () => {
  const core = fakeCore({
    "command:approvals/grant": () => ok({ request: {} }),
    "command:approvals/reject": () => ok({ request: {} }),
    "command:approvals/cancel": () => ok({ request: {} }),
  });
  const base = {
    handle: handle(),
    approval: APR,
    createdSeq: "12",
    bindingHash: BINDING,
  };
  const granted = await submitApproval(core, {
    ...base,
    decision: GRANT,
    commandInput: {},
  });
  assert.deepEqual(granted, {
    ok: true,
    value: { receipt: { kind: "entity", id: APR }, result: "accepted" },
  });
  await submitApproval(core, {
    ...base,
    decision: REJECT,
    commandInput: { reason: "  " },
  });
  await submitApproval(core, {
    ...base,
    decision: CANCEL,
    commandInput: { reason: "Not needed any more." },
  });
  const [grant, reject, cancel] = core.calls.map((call) =>
    call.body as Record<string, unknown>
  );
  assert.deepEqual(grant!.input, {
    approval: APR,
    created_seq: "12",
    binding_hash: BINDING,
  });
  assert.deepEqual(grant!.compare, { created_seq: "12" });
  assert.equal(grant!.confirmation, "H".repeat(43));
  // 공백뿐인 이유는 보내지 않는다(null).
  assert.equal(
    (reject!.input as Record<string, unknown>).closed_reason,
    null,
  );
  assert.equal(reject!.confirmation, "H".repeat(43));
  assert.deepEqual(cancel!.input, {
    approval: APR,
    created_seq: "12",
    closed_reason: "Not needed any more.",
  });
  assert.equal("confirmation" in cancel!, false);
  const tooLong = await submitApproval(core, {
    ...base,
    decision: REJECT,
    commandInput: { reason: "x".repeat(32769) },
  });
  assert.equal(tooLong.ok, false);
  assert.equal(core.calls.length, 3);
});

function grantable(sessionGrantable: boolean) {
  const base = pending();
  return {
    ...base,
    request: { ...base.request, session_grantable: sessionGrantable },
  };
}

const THREE = { approval: APR, created_seq: "12", binding_hash: BINDING };

test("platform/approvals#R18, platform/approvals#R19 [agent-I42]: session 허락이 되는 request는 미리 고른 범위를 view에 싣고, session을 고르면 binding 내용에 scope가 묶이고 once·deny는 기본값이라 빠진다", async () => {
  const read = async (preselect?: string, sessionGrantable = true) => {
    const core = fakeCore({
      "read:approvals/get": () => ok(grantable(sessionGrantable)),
      "read:approvals/text": () => ok(TEXT),
    });
    const got = await readApproval(core, APR, preselect as never);
    assert.equal(got.ok, true);
    if (!got.ok) throw new Error("read failed");
    return got.value;
  };
  const session = await read("allow_session");
  assert.deepEqual(session.content, { ...THREE, scope: "session" });
  assert.equal(
    contentBasis(session.content),
    contentBasis({ ...THREE, scope: "session" }),
  );
  assert.equal(session.view!.session_grantable, true);
  assert.equal(session.view!.preselect, "allow_session");
  // 범위가 달라진 binding은 once의 binding과 다른 내용 기준이다(once handle로 session을 못 연다).
  assert.notEqual(contentBasis(session.content), contentBasis(THREE));

  for (const choice of ["allow_once", "deny", undefined]) {
    const got = await read(choice);
    assert.deepEqual(got.content, THREE, String(choice));
    assert.equal(got.view!.session_grantable, true);
    assert.equal(got.view!.preselect, choice ?? "allow_once");
  }
  // 허락·거절·취소를 같은 정본에서 고른다. Always 같은 결정은 없다.
  assert.deepEqual(session.allowed, [GRANT, REJECT, CANCEL]);
});

test("platform/approvals#R20 [agent-I42]: session 허락이 아닌 request는 session을 미리 골라도 once만 있다", async () => {
  for (const sessionGrantable of [false, undefined]) {
    const base = pending();
    const request = sessionGrantable === undefined
      ? base
      : grantable(sessionGrantable);
    const core = fakeCore({
      "read:approvals/get": () => ok(request),
      "read:approvals/text": () => ok(TEXT),
    });
    const got = await readApproval(core, APR, "allow_session");
    assert.equal(got.ok, true);
    if (!got.ok) return;
    assert.deepEqual(got.value.content, THREE);
    assert.equal(got.value.view!.session_grantable, false);
    assert.equal(got.value.view!.preselect, "allow_once");
  }
});

test("platform/approvals#R19, shell/confirmation-window#R1 [agent-I42]: 허락은 고정 정본의 scope를 grant 입력에 싣고 once는 싣지 않으며 거절에는 scope가 없다", async () => {
  const core = fakeCore({
    "command:approvals/grant": () => ok({ request: {} }),
    "command:approvals/reject": () => ok({ request: {} }),
  });
  const base = {
    handle: handle(),
    approval: APR,
    createdSeq: "12",
    bindingHash: BINDING,
  };
  await submitApproval(core, {
    ...base,
    decision: GRANT,
    commandInput: {},
    scope: "session",
  });
  await submitApproval(core, {
    ...base,
    decision: GRANT,
    commandInput: {},
    scope: "once",
  });
  await submitApproval(core, {
    ...base,
    decision: REJECT,
    commandInput: {},
    scope: "session",
  });
  const [session, once, reject] = core.calls.map((call) =>
    call.body as { input: Record<string, unknown> }
  );
  assert.deepEqual(session!.input, { ...THREE, scope: "session" });
  assert.deepEqual(once!.input, THREE);
  assert.equal("scope" in reject!.input, false);
});

test("platform/approvals#R19, shell/confirmation-window#R1 [agent-I42]: 제출 때 scope는 handle을 만든 정본에서 오고 renderer가 보낸 값으로 넓어지지 않는다", async () => {
  const core = fakeCore({
    "read:approvals/get": () => ok(grantable(true)),
    "read:approvals/text": () => ok(TEXT),
    "command:approvals/grant": () => ok({ request: {} }),
  });
  const kinds = createKinds({
    core: () => core,
    clock: { now: () => 1 },
    random: (bytes) => bytes.fill(1),
  });
  const grant = async (preselect: string, sent: unknown) => {
    const read = await kinds.canon.read(
      {
        kind: "approval_request",
        approval: APR,
        preselect: preselect as never,
      },
      "cfw_1",
    );
    assert.equal(read.ok, true);
    if (!read.ok) return;
    core.calls.length = 0;
    const result = await kinds.submit.submit({
      handle: handle(),
      decision: GRANT,
      commandInput: sent,
      canonical: read.value,
    });
    assert.equal(result.ok, true);
    return (core.calls.find((call) => call.method === "grant")!
      .body as { input: Record<string, unknown> }).input;
  };
  assert.deepEqual(await grant("allow_session", {}), {
    ...THREE,
    scope: "session",
  });
  // once로 묶인 handle로 session을 보내려 해도 once 입력이다.
  assert.deepEqual(await grant("allow_once", { scope: "session" }), THREE);
});

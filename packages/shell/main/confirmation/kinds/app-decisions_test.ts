import assert from "node:assert/strict";
import { test } from "node:test";
import { contentBasis } from "../handle.ts";
import { GRANT } from "./approval.ts";
import type { ConfirmationIntent } from "../types.ts";
import { record } from "./core.ts";
import { APP, GRT, intents, world } from "./app-decisions_fixture.ts";
import { handle, id } from "./kinds_fixture.ts";

for (const [intent, command, kind] of intents) {
  test(`shell/confirmation-window#R5 shell/confirmation-window#R8: app-detail ${intent.kind === "owner_decision" ? intent.decision : ""}는 정확한 approval 하나와 ${kind} 창에 묶인다`, async () => {
    const { core, kinds, fixed } = world();
    const got = await kinds.canon.read(intent, "window");
    assert.equal(got.ok, true);
    if (!got.ok) return;
    assert.equal(got.value.request.kind, "approval_request");
    assert.equal(got.value.view?.kind, kind);
    const action = record(fixed().action);
    assert.equal(action.command, command);
    assert.equal(action.caller, "user");
    assert.equal(action.input_hash, contentBasis(record(action.input).value));
    const { input: _input, binding_hash: hash, ...basis } = action;
    assert.equal(hash, contentBasis(basis));
    await kinds.canon.read(intent, "window");
    assert.equal(
      core.calls.filter((call) =>
        call.resource === "approvals" && call.method === "create"
      ).length,
      1,
    );
    assert.equal(
      core.calls.filter((call) => call.method === "apply").length,
      0,
    );
    const sent = await kinds.submit.submit({
      handle: handle(),
      decision: GRANT,
      commandInput: undefined,
      canonical: got.value,
    });
    assert.equal(sent.ok, true);
    const commands = core.calls.filter((call) => call.kind === "command");
    assert.deepEqual(
      commands.map((call) => `${call.resource}/${call.method}`),
      ["approvals/create", "approvals/grant", "approvals/apply"],
    );
    const grant = record(commands[1]!.body);
    assert.equal(grant.confirmation, handle().ref);
    assert.deepEqual(grant.compare, { created_seq: "21" });
    assert.deepEqual(record(record(commands[2]!.body).input).action, action);
  });
}

test("shell/confirmation-window#R5: 선언 밖 automation·연결·requirement는 approval을 만들지 않는다", async () => {
  for (
    const intent of [
      {
        kind: "owner_decision" as const,
        concern: "apps/automations",
        decision: "enable_automation",
        targets: [APP],
        automation: "other",
      },
      {
        kind: "owner_decision" as const,
        concern: "apps/connections",
        decision: "connect_apps",
        targets: [APP, id("app", 3)],
      },
      {
        kind: "owner_decision" as const,
        concern: "apps/permissions",
        decision: "grant_access",
        targets: [APP],
        requirement: 4,
      },
    ]
  ) {
    const { core, kinds } = world();
    const got = await kinds.canon.read(intent, "window");
    assert.equal(got.ok, false);
    if (!got.ok) assert.equal(got.error.code, "not_found");
    assert.equal(
      core.calls.filter((call) => call.kind === "command").length,
      0,
    );
  }
});

test("apps/permissions#R21: 종료를 확인하지 못해 회수가 끝나지 않으면 완료로 알리지 않고 같은 결정으로 다시 확인한다", async () => {
  const { core, kinds } = world({
    "command:approvals/apply": () => ({
      ok: false,
      error: {
        code: "unavailable",
        message: "process termination is not confirmed",
      },
    }),
  });
  const intent: ConfirmationIntent = {
    kind: "owner_decision",
    concern: "apps/permissions",
    decision: "revoke_grant",
    targets: [APP, GRT],
  };
  const got = await kinds.canon.read(intent, "window");
  assert.equal(got.ok, true);
  if (!got.ok) return;
  const sent = await kinds.submit.submit({
    handle: handle(),
    decision: GRANT,
    commandInput: undefined,
    canonical: got.value,
  });
  assert.deepEqual(sent, { ok: false, unknown: true });
  assert.equal(
    core.calls.filter((call) => call.method === "apply").length,
    1,
  );
});

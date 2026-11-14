import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { err, ok } from "../../../base/mod.ts";
import { defineCommand } from "../../../protocol/base/mod.ts";
import type {
  AuthenticatedContext,
  CommandDefinition,
  Tx,
} from "../../../protocol/server/mod.ts";
import {
  createAfterCommitCollector,
  STATE_CHANGED_TOPIC,
} from "./after-commit.ts";
import { createCommandDispatch } from "./dispatch.ts";

// 화면은 StateChanged로만 다시 읽는다. 되돌아간 tx의 선언이 나가면 없던 일을 보고, `tx.call`로 돈 command의 선언이
// 빠지면 바뀐 것을 놓친다. writer Worker가 쓰는 collector와 `tx.call` dispatch를 그대로 쓴다.
// flow catalog는 core의 route 정의 호출을 글로 찾아 입구로 센다. test route는 입구가 아니라 다른 이름으로 부른다.
const probe = defineCommand;
const inner = probe({
  resource: "probe",
  method: "inner",
  name: "Inner",
  changes: [{ name: "agents", id: (input) => input.agent }],
  input: z.strictObject({ agent: z.string() }),
  output: z.object({}),
  actors: ["user"],
  errors: ["invalid_input"],
});
const outer = probe({
  resource: "probe",
  method: "outer",
  name: "Outer",
  changes: ["apps"],
  input: z.strictObject({ fail: z.boolean() }),
  output: z.object({}),
  actors: ["user"],
  errors: ["invalid_input"],
});

const ctx = {
  actor: "user:usr_1",
  principal: "usr_1",
  scope: { operations: ["Inner", "Outer"], targets: {} },
  conditions: {},
} as unknown as AuthenticatedContext;
const tx = {} as Tx;

const collector = createAfterCommitCollector();
const commands = new Map<string, CommandDefinition>();
commands.set(
  "Inner",
  collector.declared({
    route: inner,
    dispatchable: true,
    handle: () => ok({}),
  } as CommandDefinition),
);
commands.set(
  "Outer",
  collector.declared({
    route: outer,
    handle(_tx, _request, input) {
      const call = createCommandDispatch(commands, ctx, ctx as never, "Outer");
      const called = call.call(tx, inner, { agent: "agt_1" }, {});
      if (!called.ok) return called;
      return (input as { fail: boolean }).fail
        ? err({ code: "invalid_input", message: "rolled back" })
        : ok({});
    },
  } as CommandDefinition),
);

// executor처럼 handler 결과로 commit 여부를 정한다.
function run(fail: boolean) {
  return collector.run(async () => {
    const handled = commands
      .get("Outer")!
      .handle(tx, ctx as never, { fail }, {} as never);
    if (!handled.ok) return handled;
    return ok({
      result: handled.value,
      replayed: false,
      first_seq: null,
      last_seq: null,
    });
  });
}

test("다른 command 안에서 돈 command의 선언도 commit 결과에 실린다", async () => {
  const done = await run(false);
  assert.ok(done.ok);
  assert.deepEqual(
    done.value.after_commit?.filter((a) => a.topic === STATE_CHANGED_TOPIC),
    [
      { topic: STATE_CHANGED_TOPIC, data: [{ name: "agents", id: "agt_1" }] },
      { topic: STATE_CHANGED_TOPIC, data: [{ name: "apps", id: null }] },
    ],
  );
});

test("되돌아간 tx의 선언은 다음 commit에도 실리지 않는다", async () => {
  const failed = await run(true);
  assert.equal(failed.ok, false);
  const next = await run(false);
  assert.ok(next.ok);
  assert.equal(next.value.after_commit?.length, 2);
});

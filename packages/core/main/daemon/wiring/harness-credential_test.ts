import assert from "node:assert/strict";
import { test } from "node:test";
import { cryptoRandom, manualClock, ok } from "../../../../base/mod.ts";
import { callReply } from "../../../../protocol/lophn-agent/calls.ts";
import { harnessOperations } from "../../../agent-workspaces/credentials.ts";
import { CredentialRegistry } from "../../../server/identity/registry.ts";
import { createHarnessCredentials } from "./harness-credential.ts";

// harness는 사람 token이 아니라 그 session·turn의 agent 자격으로 `lophn`을 부른다. 깨지면 harness 하나가 다른 session을
// 대신해 답하거나, turn이 끝난 뒤에도 자격이 살아 있거나, 사람의 자격으로 답하게 된다.
const id = (prefix: string, n: number) =>
  `${prefix}_${String(n).padStart(26, "0")}`;
const SESSION = id("ses", 1);
const TURN = id("trn", 1);

function setup() {
  const registry = new CredentialRegistry({
    epoch: "epoch",
    random: cryptoRandom,
    clock: manualClock(Date.parse("2026-11-04T00:00:00Z")),
    operations: [
      ...harnessOperations("home").map((name) => ({
        name,
        // call.reply는 실제 route가 정한 actor 그대로다.
        actors: name === callReply.name ? callReply.actors : ["agent" as const],
        kind: "command" as const,
      })),
      { name: "file.write", actors: ["agent"], kind: "command" },
    ],
  });
  const credentials = createHarnessCredentials({
    registry,
    record: () => Promise.resolve(ok(undefined)),
  });
  return { registry, credentials };
}

async function agentContext(
  { registry, credentials }: ReturnType<typeof setup>,
  session = SESSION,
  turn = TURN,
) {
  const token = await credentials.issue({ session, turn, workspace: null });
  assert.ok(token.ok);
  const authenticated = await registry.authenticate(token.value);
  assert.ok(authenticated.ok);
  return authenticated.value;
}

test("a harness turn credential answers only its own session and stops at turn end", async () => {
  const kit = setup();
  const ctx = await agentContext(kit);
  assert.ok(harnessOperations("home").includes(callReply.name));
  assert.ok(
    kit.registry.authorize(ctx, callReply.name, {
      session: SESSION,
      turn: TURN,
    }).ok,
  );
  // 다른 session의 입력, lophn tool의 route(file), 다른 turn에는 닿지 않는다.
  assert.equal(
    kit.registry.authorize(ctx, callReply.name, {
      session: id("ses", 2),
      turn: TURN,
    }).ok,
    false,
  );
  assert.equal(
    kit.registry.authorize(ctx, "file.write", { session: SESSION, turn: TURN })
      .ok,
    false,
  );
  assert.equal(
    kit.registry.authorize(ctx, callReply.name, {
      session: SESSION,
      turn: id("trn", 2),
    }).ok,
    false,
  );
  kit.credentials.end(TURN);
  assert.equal(
    kit.registry.authorize(ctx, callReply.name, {
      session: SESSION,
      turn: TURN,
    }).ok,
    false,
  );
});

test("a user credential cannot reply to a call", () => {
  const { registry } = setup();
  const issued = registry.issue({
    actor: "user",
    principal: "user",
    scope: { operations: [callReply.name], targets: {} },
    conditions: { process: "shell" },
  });
  assert.equal(issued.ok, false);
});

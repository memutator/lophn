import assert from "node:assert/strict";
import { test } from "node:test";
import { cryptoRandom, manualClock, ok } from "../../../../base/mod.ts";
import { hostTake } from "../../../../protocol/lophn-agent/host-queue.ts";
import { harnessOperations } from "../../../agent-workspaces/credentials.ts";
import { CredentialRegistry } from "../../../server/identity/registry.ts";
import { createHarnessCredentials } from "./harness-credential.ts";

// extension handler의 `core`는 사람 token이 아니라 그 호출 session의 agent 자격이다. 깨지면 extension tool 하나로 agent가
// 사람 권한(설정 바꾸기 등)을 얻거나, 다른 session을 대신하거나, 호출이 끝난 뒤에도 자격이 살아 있게 된다.
const id = (prefix: string, n: number) =>
  `${prefix}_${String(n).padStart(26, "0")}`;
const SESSION = id("ses", 1);
const TURN = id("trn", 1);

test("a tool call credential reaches only lophn commands of its own session and stops with the call", async () => {
  const registry = new CredentialRegistry({
    epoch: "epoch",
    random: cryptoRandom,
    clock: manualClock(Date.parse("2026-11-08T00:00:00Z")),
    operations: [
      ...harnessOperations("home").map((name) => ({
        name,
        actors: ["agent" as const],
        kind: "command" as const,
      })),
      { name: hostTake.name, actors: ["user"], kind: "command" },
    ],
  });
  const credentials = createHarnessCredentials({
    registry,
    record: () => Promise.resolve(ok(undefined)),
  });
  const issued = await credentials.lease({
    session: SESSION,
    turn: TURN,
    workspace: null,
    process: "extension",
  });
  assert.ok(issued.ok);
  const authenticated = await registry.authenticate(issued.value.token);
  assert.ok(authenticated.ok);
  const ctx = authenticated.value;
  assert.equal(ctx.actor, `agent:${SESSION}`);

  const own = { session: SESSION, turn: TURN };
  const [lophnRoute] = harnessOperations("home");
  assert.ok(registry.authorize(ctx, lophnRoute!, own).ok);
  // 사람 전용 route와 다른 session에는 닿지 않는다.
  assert.equal(registry.authorize(ctx, hostTake.name, own).ok, false);
  assert.equal(
    registry.authorize(ctx, lophnRoute!, { session: id("ses", 2), turn: TURN })
      .ok,
    false,
  );

  credentials.release(issued.value.ref);
  assert.equal(registry.authorize(ctx, lophnRoute!, own).ok, false);
});

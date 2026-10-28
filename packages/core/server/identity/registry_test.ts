import assert from "node:assert/strict";
import { test } from "node:test";

import { cryptoRandom, manualClock } from "../../../base/mod.ts";
import { CredentialRegistry } from "./registry.ts";

const id = (prefix: string, n: number) =>
  `${prefix}_${String(n).padStart(26, "0")}`;
const SESSION = id("ses", 1);
const TURN = id("trn", 1);

function registry() {
  return new CredentialRegistry({
    epoch: "epoch",
    random: cryptoRandom,
    clock: manualClock(Date.parse("2026-10-16T00:00:00Z")),
    operations: [{ name: "file.read", actors: ["agent"], kind: "read" }],
  });
}

function issue(
  registry: CredentialRegistry,
  session: string,
  turn: string,
  actor = `agent:${session}` as const,
) {
  return registry.issue({
    actor,
    principal: actor,
    scope: { operations: ["file.read"], targets: { session, turn } },
    conditions: { session, turn, process: "agent-runtime" },
  });
}

// agent credential은 그 session·turn에만 닿고, turn이 끝나면 더 쓰이지 않는다.
test("an agent credential reaches only its own session and turn", async () => {
  const keys = registry();
  const issued = await issue(keys, SESSION, TURN);
  assert.ok(issued.ok);
  const ref = { credential_ref: issued.value.credential_ref };

  assert.ok(
    keys.authorize(ref, "file.read", { session: SESSION, turn: TURN }).ok,
  );
  assert.deepStrictEqual(
    keys.authorize(ref, "file.read", { session: id("ses", 2), turn: TURN }).ok,
    false,
  );
  assert.deepStrictEqual(
    keys.authorize(ref, "file.read", { session: SESSION, turn: id("trn", 2) })
      .ok,
    false,
  );

  // 다른 session의 이름으로 청하거나 turn을 빼면 발급되지 않는다.
  assert.deepStrictEqual(
    (await issue(keys, SESSION, TURN, `agent:${id("ses", 2)}` as never)).ok,
    false,
  );
  const withoutTurn = await keys.issue({
    actor: `agent:${SESSION}`,
    principal: `agent:${SESSION}`,
    scope: { operations: ["file.read"], targets: { session: SESSION } },
    conditions: { session: SESSION, process: "agent-runtime" },
  });
  assert.deepStrictEqual(withoutTurn.ok, false);

  assert.deepStrictEqual(keys.endBy("turn", TURN), 1);
  assert.deepStrictEqual(
    keys.authorize(ref, "file.read", {
      session: SESSION,
      turn: TURN,
    }).ok,
    false,
  );
});

// 앱 process가 다시 뜰 때 그 앱의 app credential만 끝나고, 같은 앱에서 도는 agent의 turn credential은 남는다.
test("앱 credential을 끝내도 같은 앱 조건의 agent credential은 남는다", () => {
  const keys = new CredentialRegistry({
    epoch: "epoch",
    random: cryptoRandom,
    clock: manualClock(Date.parse("2026-10-16T00:00:00Z")),
    operations: [
      { name: "ticket.show", actors: ["app", "agent"], kind: "read" },
    ],
  });
  const app = id("app", 1);
  const session = id("ses", 1);
  const turn = id("trn", 1);
  const release = id("rel", 1);
  const process = id("prc", 1);
  const appCredential = keys.issue({
    actor: `app:${app}`,
    principal: `app:${app}`,
    scope: {
      operations: ["ticket.show"],
      targets: { app, release, process, mode: "live" },
    },
    conditions: { app, release, process, mode: "live" },
  });
  const agentCredential = keys.issue({
    actor: `agent:${session}`,
    principal: `agent:${session}`,
    scope: { operations: ["ticket.show"], targets: { session, turn } },
    conditions: { app, session, turn },
  });
  assert.ok(appCredential.ok && agentCredential.ok);

  assert.deepStrictEqual(keys.endBy("app", app, "app"), 1);
  assert.deepStrictEqual(keys.revalidate(appCredential.value).ok, false);
  assert.ok(keys.revalidate(agentCredential.value).ok);
});

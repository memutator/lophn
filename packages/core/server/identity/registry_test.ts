import { assert, assertEquals } from "@std/assert";
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
Deno.test("an agent credential reaches only its own session and turn", async () => {
  const keys = registry();
  const issued = await issue(keys, SESSION, TURN);
  assert(issued.ok);
  const ref = { credential_ref: issued.value.credential_ref };

  assert(keys.authorize(ref, "file.read", { session: SESSION, turn: TURN }).ok);
  assertEquals(
    keys.authorize(ref, "file.read", { session: id("ses", 2), turn: TURN }).ok,
    false,
  );
  assertEquals(
    keys.authorize(ref, "file.read", { session: SESSION, turn: id("trn", 2) })
      .ok,
    false,
  );

  // 다른 session의 이름으로 청하거나 turn을 빼면 발급되지 않는다.
  assertEquals(
    (await issue(keys, SESSION, TURN, `agent:${id("ses", 2)}` as never)).ok,
    false,
  );
  const withoutTurn = await keys.issue({
    actor: `agent:${SESSION}`,
    principal: `agent:${SESSION}`,
    scope: { operations: ["file.read"], targets: { session: SESSION } },
    conditions: { session: SESSION, process: "agent-runtime" },
  });
  assertEquals(withoutTurn.ok, false);

  assertEquals(keys.endBy("turn", TURN), 1);
  assertEquals(
    keys.authorize(ref, "file.read", {
      session: SESSION,
      turn: TURN,
    }).ok,
    false,
  );
});

// 앱 process가 다시 뜰 때 그 앱의 app credential만 끝나고, 같은 앱의 coding token은 남는다.
Deno.test("ending an app's credentials leaves its coding token alive", () => {
  const keys = new CredentialRegistry({
    epoch: "epoch",
    random: cryptoRandom,
    clock: manualClock(Date.parse("2026-10-16T00:00:00Z")),
    operations: [
      { name: "ticket.show", actors: ["app", "coding_agent"], kind: "read" },
    ],
  });
  const app = id("app", 1);
  const coding = id("ses", 1);
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
  const codingToken = keys.issue({
    actor: `coding_agent:${coding}`,
    principal: `coding_agent:${coding}`,
    scope: { operations: ["ticket.show"], targets: { app } },
    conditions: { app },
  });
  assert(appCredential.ok && codingToken.ok);

  assertEquals(keys.endBy("app", app, "app"), 1);
  assertEquals(keys.revalidate(appCredential.value).ok, false);
  assert(keys.revalidate(codingToken.value).ok);
});

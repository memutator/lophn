import { assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { ok, type Result } from "../../../../base/mod.ts";
import {
  type RequestContext,
  TargetAuthorization,
  type Tx,
} from "../../../../protocol/server/mod.ts";
import type {
  ActivationComparison,
  ReleaseRecord,
} from "../../../../protocol/apps/mod.ts";
import { afterCommit } from "../../../storage/ledger/after-commit.ts";
import { appsSchemaSteps } from "../../registration/schema.ts";
import { createReleaseCommands } from "../commands.ts";
import { releasesSchemaSteps } from "../schema.ts";
import { insertRelease, loadRelease } from "../store.ts";
import { allowedConsents, waitingConsents } from "./consents.ts";
import { createActivationHandlers } from "./handler.ts";

const APP = "app_01hzzzzzzzzzzzzzzzzzzzzzza";
const REL = "rel_01hzzzzzzzzzzzzzzzzzzzzz01";

const ctxOf = (actor: string): RequestContext => ({
  principal: actor,
  actor,
  scope: { operations: [], targets: {} },
  conditions: {},
  credential_ref: actor,
});

Deno.test("사람이 동의하기 전에는 선언이 넓어진 release가 activate되지 않는다", async () => {
  const db = new DatabaseSync(":memory:");
  for (const step of [...appsSchemaSteps, ...releasesSchemaSteps]) {
    db.exec(step.sql);
  }
  db.prepare(
    `INSERT INTO apps VALUES (?, 'slug', 'n', 'd', NULL, NULL, NULL, 1, '1', 'active')`,
  ).run(APP);
  const ports = new Map<unknown, unknown>([
    [TargetAuthorization, () => ok(undefined)],
    [afterCommit, { push: () => {} }],
  ]);
  let count = 0;
  const tx = {
    sql: {
      run: (text: string, params: never[]) => db.prepare(text).run(...params),
      get: (text: string, params: never[]) =>
        db.prepare(text).get(...params) as Record<string, never> | undefined,
      all: (text: string, params: never[]) =>
        db.prepare(text).all(...params) as Record<string, never>[],
    },
    newId: (prefix: string) =>
      `${prefix}_01h${String(++count).padStart(23, "z")}`,
    now: () => "2026-10-16T00:00:00.000Z",
    emit: () => String(++count),
    port: (key: unknown) => ports.get(key),
  } as unknown as Tx;
  insertRelease(
    tx,
    {
      id: REL,
      app: APP,
      number: 1,
      code_commit: "0".repeat(40),
      bundle_hash: "0".repeat(64),
      blueprint_hash: "0".repeat(64),
      data_schema: 1,
      data_changes: [],
      created_by: "coding_agent:ses_01hzzzzzzzzzzzzzzzzzzzzzza",
      created_at: "2026-10-16T00:00:00.000Z",
      status: "prepared",
    } as unknown as ReleaseRecord,
    JSON.stringify({ tools: [] }),
    {} as never,
  );

  const commands = createReleaseCommands();
  const call = (
    command: "askConsent" | "consent",
    actor: string,
    input: unknown,
    compare: unknown = {},
  ) =>
    (commands[command].handle as (...a: unknown[]) => Result<unknown>)(
      tx,
      ctxOf(actor),
      input,
      compare,
    );

  // 선언이 넓어진 비교다.
  let comparison: ActivationComparison = {
    previous_release: null,
    first: false,
    added_resources: ["api.example.com"],
    added_tools: [],
    loss_steps: [],
  };
  const started: string[] = [];
  const handlers = createActivationHandlers({
    releases: {
      get: () => loadRelease(tx.sql, REL),
      comparison: () => Promise.resolve(ok(comparison)),
    },
    consents: {
      ask: (release, compared) => {
        const done = call("askConsent", "machine", {
          release: release.id,
          comparison: compared,
        });
        return Promise.resolve(done.ok ? ok(undefined) : done);
      },
    },
    enqueue: (_app, release) => {
      started.push(release);
      return ok(undefined);
    },
  });
  const activate = () => {
    const found = loadRelease(tx.sql, REL);
    if (!found.ok || found.value === null) throw new Error("no release");
    return handlers.activate(found.value);
  };
  const allow = () =>
    call(
      "consent",
      "user",
      { release: REL, choice: "allow" },
      { requested_at: waitingConsents(tx.sql)[0].requested_at },
    );

  // release.activate의 판정은 시작하지 않고 기다리는 줄 하나를 만든다. 다시 불러도 하나다.
  assertEquals(await activate(), ok("waiting_consent"));
  assertEquals(await activate(), ok("waiting_consent"));
  assertEquals(started, []);
  assertEquals(waitingConsents(tx.sql).length, 1);

  // 사람이 아니면 허락하지 못한다.
  for (
    const actor of ["machine", "coding_agent:ses_01hzzzzzzzzzzzzzzzzzzzzzza"]
  ) {
    const done = call("consent", actor, { release: REL, choice: "allow" });
    assertEquals(!done.ok && done.error.code, "forbidden");
  }
  assertEquals(allowedConsents(tx.sql), []);

  // 허락한 뒤 비교가 바뀌었으면 시작하지 않고 새 비교로 다시 묻는다.
  assertEquals(allow().ok, true);
  assertEquals(allowedConsents(tx.sql).length, 1);
  comparison = { ...comparison, added_resources: ["api.example.com", "x.io"] };
  await handlers.consented(allowedConsents(tx.sql)[0]);
  assertEquals(started, []);
  assertEquals(allowedConsents(tx.sql), []);
  assertEquals(waitingConsents(tx.sql).length, 1);

  // 지금 비교를 허락하면 그 release를 시작한다.
  assertEquals(allow().ok, true);
  await handlers.consented(allowedConsents(tx.sql)[0]);
  assertEquals(started, [REL]);
});

import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { ok, type Result } from "../../../base/mod.ts";
import type { RequestContext, Tx } from "../../../protocol/server/mod.ts";
import { afterCommit } from "../../storage/ledger/after-commit.ts";
import { assignmentPorts } from "../assignment/mod.ts";
import { createShareRequestCommands } from "./commands.ts";
import { shareLookupPort } from "./ports.ts";
import { shareRequestSteps } from "./schema.ts";

const APP = "app_01hzzzzzzzzzzzzzzzzzzzzzza";
const OTHER_APP = "app_01hzzzzzzzzzzzzzzzzzzzzzzb";
const AGENT = "agt_01hzzzzzzzzzzzzzzzzzzzzzza";
const SESSION = "ses_01hzzzzzzzzzzzzzzzzzzzzzza";

const ctxOf = (actor: string, app?: string): RequestContext => ({
  principal: actor,
  actor,
  scope: { operations: [], targets: {} },
  conditions: app === undefined ? {} : { app },
  credential_ref: actor,
});

// agent가 연 요청은 사람이 승인하기 전에는 어느 agent 정의(할당)도 바꾸지 않고,
// 사람이 아닌 자격은 결정하지 못한다.
test("an opened share request changes no assignment until the user approves", () => {
  const db = new DatabaseSync(":memory:");
  for (const step of shareRequestSteps) db.exec(step.sql);
  const sets: { agent: string; entries: unknown }[] = [];
  const pushed: { topic: string; data: unknown }[] = [];
  const ports = new Map<unknown, unknown>([
    [
      shareLookupPort,
      {
        app: (id: string) =>
          id === APP
            ? {
                name: "Notes",
                slug: "notes",
                public_skills: 1,
                public_commands: 2,
              }
            : null,
        agent: (id: string) => (id === AGENT ? "Reviewer" : null),
      },
    ],
    [
      assignmentPorts,
      {
        get: (agent: string) =>
          ok({
            assignment: {
              agent,
              entries: [{ app: OTHER_APP, removed_tools: ["danger"] }],
            },
            revision: 7,
          }),
        set: (agent: string, entries: unknown, revision: number) => {
          assert.deepStrictEqual(revision, 7);
          sets.push({ agent, entries });
          return ok({ assignment: { agent, entries }, revision: 8 });
        },
      },
    ],
    [
      afterCommit,
      { push: (topic: string, data: unknown) => pushed.push({ topic, data }) },
    ],
  ]);
  let at = 0;
  const tx = {
    sql: {
      run: (text: string, params: never[]) => db.prepare(text).run(...params),
      get: (text: string, params: never[]) =>
        db.prepare(text).get(...params) as Record<string, never> | undefined,
      all: (text: string, params: never[]) =>
        db.prepare(text).all(...params) as Record<string, never>[],
    },
    now: () => `2026-11-02T00:00:0${++at}.000Z`,
    port: (key: unknown) => ports.get(key),
  } as unknown as Tx;
  const rows = () =>
    Number(db.prepare("select count(*) as n from share_requests").get()!.n);
  const commands = createShareRequestCommands();
  const open = (ctx: RequestContext) =>
    (
      commands.open.handle as (
        ...a: unknown[]
      ) => Result<{ requested_at: string }>
    )(tx, ctx, { agents: [AGENT], coding_agents: true, reason: "" });
  const decide = (actor: string, requested_at: string) =>
    (commands.decide.handle as (...a: unknown[]) => Result<unknown>)(
      tx,
      ctxOf(actor),
      { app: APP, choice: "approve" },
      { requested_at },
    );

  // 앱 workspace 밖의 agent는 열지 못한다.
  const outside = open(ctxOf(`agent:${SESSION}`));
  assert.deepStrictEqual(!outside.ok && outside.error.code, "forbidden");

  const opened = open(ctxOf(`agent:${SESSION}`, APP));
  assert.ok(opened.ok);
  assert.deepStrictEqual(sets, []);

  for (const actor of [`agent:${SESSION}`, "machine"]) {
    const done = decide(actor, opened.value.requested_at);
    assert.deepStrictEqual(!done.ok && done.error.code, "forbidden", actor);
  }
  assert.deepStrictEqual(sets, []);
  assert.deepStrictEqual(rows(), 1);

  // 새 요청이 대신했으면 사람이 본 값으로는 결정하지 못한다.
  const replaced = open(ctxOf(`agent:${SESSION}`, APP));
  assert.ok(replaced.ok);
  const stale = decide("user", opened.value.requested_at);
  assert.deepStrictEqual(!stale.ok && stale.error.code, "conflict");
  assert.deepStrictEqual(sets, []);

  // 승인하면 받을 agent의 할당에 앱을 더하고 이미 있던 줄은 그대로 둔다. coding agent 몫은 commit 뒤로 넘긴다.
  const done = decide("user", replaced.value.requested_at);
  assert.ok(done.ok);
  assert.deepStrictEqual(sets, [
    {
      agent: AGENT,
      entries: [
        { app: OTHER_APP, removed_tools: ["danger"] },
        { app: APP, removed_tools: [] },
      ],
    },
  ]);
  assert.ok(
    pushed.some(
      (item) =>
        item.topic === "share_coding" &&
        (item.data as { slug: string }).slug === "notes",
    ),
  );
  assert.deepStrictEqual(rows(), 0);
});

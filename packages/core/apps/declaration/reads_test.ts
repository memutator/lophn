import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { ok } from "../../../base/mod.ts";
import type { RequestContext } from "../../../protocol/server/mod.ts";
import { createTargetAuthorizer } from "../../storage/ledger/target-authorization.ts";
import { appsSchemaSteps } from "../registration/schema.ts";
import { createDeclarationReads } from "./reads.ts";

const APP_A = "app_01hzzzzzzzzzzzzzzzzzzzzzza";
const APP_B = "app_01hzzzzzzzzzzzzzzzzzzzzzzb";
const AGENT = "agent:ses_01hzzzzzzzzzzzzzzzzzzzzzza";

// 앱 A에 묶인 Project Manager는 다른 앱의 tool 목록은 읽지만 log·호출 기록은 여전히 not_found다.
// 목록 route가 앱 범위 판정을 하지 않는 것이 log·호출 기록으로 번지면 다른 앱 데이터가 샌다.
test("Project Manager 자격은 다른 앱의 tool 목록을 읽지만 다른 앱의 log·호출 기록은 여전히 not_found다", () => {
  const db = new DatabaseSync(":memory:");
  for (const step of appsSchemaSteps) db.exec(step.sql);
  for (const [id, slug] of [[APP_A, "a"], [APP_B, "b"]]) {
    db.prepare(
      `INSERT INTO apps (id, slug, name, description, run_enabled, revision, status)
       VALUES (?, ?, ?, 'does things', 0, '1', 'active')`,
    ).run(id, slug, `app ${slug}`);
  }
  const sql = {
    get: (text: string, params: never[]) =>
      db.prepare(text).get(...params) as never,
    all: (text: string, params: never[]) =>
      db.prepare(text).all(...params) as never,
  };
  const reads = createDeclarationReads((_sql, app) =>
    ok({
      release: { app },
      declaration: {
        name: `app ${app}`,
        description: "does things",
        tools: [{
          name: "add",
          title: "Add",
          description: "adds",
          effect: "write",
          public: false,
          domain: "notes",
          inputSchema: { type: "object" },
        }],
      },
    } as never)
  );
  const ctx: RequestContext = {
    principal: AGENT,
    actor: AGENT,
    scope: {
      operations: ["app.tool_index", "app.logs", "app.invocations"],
      targets: {},
    },
    conditions: { app: APP_A },
    credential_ref: "agent",
  };
  const snapshot = { sql, as_of_seq: "1", port: () => undefined } as never;

  const list = reads.appToolIndex.handle(snapshot, ctx, {});
  assert.ok(list.ok);
  assert.deepStrictEqual(
    list.value.apps.map((entry) => entry.app),
    [APP_A, APP_B],
  );
  assert.deepStrictEqual(list.value.apps[1].tools[0].name, "add");
  assert.ok(!("inputSchema" in list.value.apps[1].tools[0]));
  const one = reads.appToolIndex.handle(snapshot, ctx, { app: APP_B });
  assert.ok(one.ok);
  assert.deepStrictEqual(one.value.apps[0].tools[0].inputSchema, {
    type: "object",
  });
  assert.ok(!("outputSchema" in one.value.apps[0].tools[0]));

  const authorize = createTargetAuthorizer(ctx);
  for (const operation of ["app.logs", "app.invocations"]) {
    const denied = authorize(ctx, operation, { app: APP_B });
    assert.ok(!denied.ok);
    assert.deepStrictEqual(denied.error.code, "not_found");
  }
});

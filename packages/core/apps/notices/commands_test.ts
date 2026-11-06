import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import type { Result } from "../../../base/mod.ts";
import { NOTICE_PER_APP_MAX } from "../../../protocol/apps/notice.ts";
import type { RequestContext, Tx } from "../../../protocol/server/mod.ts";
import { afterCommit } from "../../storage/ledger/after-commit.ts";
import { appsSchemaSteps } from "../registration/schema.ts";
import { createNoticeCommands } from "./commands.ts";
import { noticeSchemaSteps } from "./schema.ts";

const APP = "app_01hzzzzzzzzzzzzzzzzzzzzzza";

const ctxOf = (actor: string): RequestContext => ({
  principal: actor,
  actor,
  scope: { operations: [], targets: {} },
  conditions: {},
  credential_ref: actor,
});

// 같은 key는 열린 줄 하나를 대신하고, 앱마다 열린 줄은 상한을 넘지 않는다. 넘친 줄은 Closed로 화면에서도 빠진다.
test("the same key replaces its open notice and an app keeps at most the cap of open notices", () => {
  const db = new DatabaseSync(":memory:");
  for (const step of [...appsSchemaSteps, ...noticeSchemaSteps]) {
    db.exec(step.sql);
  }
  db.prepare(
    `insert into apps (id, slug, name, description, run_enabled, revision, status)
     values (?, 'usage', 'Usage', 'tracks usage', 1, '1', 'active')`,
  ).run(APP);
  const pushed: { type: string; payload: { id: string } }[] = [];
  let at = 0;
  let ids = 0;
  const tx = {
    sql: {
      run: (text: string, params: never[]) => db.prepare(text).run(...params),
      get: (text: string, params: never[]) =>
        db.prepare(text).get(...params) as Record<string, never> | undefined,
      all: (text: string, params: never[]) =>
        db.prepare(text).all(...params) as Record<string, never>[],
    },
    now: () => new Date(Date.UTC(2026, 10, 5) + ++at * 1000).toISOString(),
    newId: (prefix: string) => `${prefix}_${String(++ids).padStart(26, "0")}`,
    port: (key: unknown) =>
      key === afterCommit
        ? {
            push: (_topic: string, data: (typeof pushed)[number]) =>
              pushed.push(data),
          }
        : undefined,
  } as unknown as Tx;
  const post = (input: { title: string; key?: string }) =>
    (
      createNoticeCommands().post.handle as (
        ...a: unknown[]
      ) => Result<{ id: string }>
    )(tx, ctxOf(`app:${APP}`), input);
  const open = () =>
    db
      .prepare("select id, title from app_notices where app = ? order by id")
      .all(APP)
      .map((row) => ({ id: String(row["id"]), title: String(row["title"]) }));

  const first = post({ title: "Weekly limit under 20%", key: "limit" });
  const second = post({ title: "Weekly limit under 10%", key: "limit" });
  assert.ok(first.ok && second.ok);
  assert.deepStrictEqual(second.value.id, first.value.id);
  assert.deepStrictEqual(open(), [
    { id: first.value.id, title: "Weekly limit under 10%" },
  ]);
  assert.deepStrictEqual(
    pushed.map((event) => event.type),
    ["AppNoticePosted", "AppNoticePosted"],
  );

  pushed.length = 0;
  for (let n = 0; n < NOTICE_PER_APP_MAX + 5; n++) {
    assert.ok(post({ title: `event ${n}` }).ok);
  }
  const left = open();
  assert.deepStrictEqual(left.length, NOTICE_PER_APP_MAX);
  // 가장 오래된 여섯(key 줄과 처음 다섯)이 빠진다.
  assert.ok(!left.some((row) => row.id === first.value.id));
  assert.deepStrictEqual(left[0]?.title, "event 5");
  assert.deepStrictEqual(
    pushed.filter((event) => event.type === "AppNoticeClosed").length,
    6,
  );
});

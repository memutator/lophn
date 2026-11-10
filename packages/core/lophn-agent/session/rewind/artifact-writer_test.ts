import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import type { Sql } from "../../../../protocol/server/mod.ts";
import { turnSchemaSteps } from "../../run-loop/schema.ts";
import { toolsSchemaSteps } from "../../tools/model.ts";
import { lastArtifactWriter, revertSchemaSteps } from "./mod.ts";
import { conversationTestSteps } from "../test-steps.ts";

const ROOT_A = "/data/projects/prj_a/artifacts";
const ROOT_B = "/data/projects/prj_b/artifacts";

function setup() {
  const db = new DatabaseSync(":memory:");
  db.exec("pragma foreign_keys = off");
  for (const step of [
    ...conversationTestSteps,
    ...turnSchemaSteps,
    ...toolsSchemaSteps,
    ...revertSchemaSteps,
  ])
    db.exec(step.sql);
  const sql: Sql = {
    run: (query, params) => db.prepare(query).run(...params),
    get: (query, params) => db.prepare(query).get(...params) as never,
    all: (query, params) => db.prepare(query).all(...params) as never,
  };
  let seq = 0;
  // session 하나와 그 turn의 checkpoint 하나를 만든다.
  const session = (
    id: string,
    o: {
      agent?: string;
      workspace?: { kind: "project" | "app"; id: string };
      lifecycle?: string;
    },
  ) => {
    const workspace = o.workspace ?? PROJECT;
    sql.run(
      `insert into sessions (id, agent, project, app, workspace_kind, workspace_id, lifecycle, created_seq, state_seq)
       values (?, ?, ?, ?, ?, ?, ?, 1, 1)`,
      [
        id,
        o.agent ?? "agt_1",
        workspace.kind === "project" ? workspace.id : null,
        workspace.kind === "app" ? workspace.id : null,
        workspace.kind,
        workspace.id,
        o.lifecycle ?? "open",
      ],
    );
    sql.run("insert into checkpoints (message, session) values (?, ?)", [
      `msg_${id}`,
      id,
    ]);
  };
  const write = (
    session: string,
    root: string,
    path: string,
    revertedBy: string | null = null,
  ) => {
    sql.run(
      `insert into rewind_files
         (tool_call, root, path, checkpoint, seq, before_exists, after_exists, after_sha256, reverted_by)
       values (?, ?, ?, ?, ?, 0, 1, ?, ?)`,
      [
        `tcl_${++seq}`,
        root,
        path,
        `msg_${session}`,
        seq,
        "a".repeat(64),
        revertedBy,
      ],
    );
  };
  return { sql, session, write };
}

const PROJECT = { kind: "project", id: "prj_a" } as const;
const APP = { kind: "app", id: "app_1" } as const;

test("artifact annotation의 받는 쪽은 그 artifacts 폴더에 마지막으로 쓴 그 owner workspace의 열린 session이다", () => {
  const { sql, session, write } = setup();
  session("ses_a", {});
  session("ses_b", { workspace: { kind: "project", id: "prj_b" } });
  session("ses_closed", { lifecycle: "archived" });
  // 같은 그릇의 다른 agent session이다.
  session("ses_op", { agent: "agt_2" });
  session("ses_app", { workspace: APP });
  const find = (
    root: string,
    name: string,
    owner: { kind: "project" | "app"; id: string } = PROJECT,
  ) =>
    lastArtifactWriter(sql, {
      root,
      name,
      owner,
    })?.session ?? null;

  // 같은 이름이 두 그릇에 있어도 그 그릇의 root에 쓴 session만 나온다.
  write("ses_a", ROOT_A, "report/index.html");
  write("ses_b", ROOT_B, "report/index.html");
  assert.deepStrictEqual(find(ROOT_A, "report"), "ses_a");
  assert.deepStrictEqual(
    find(ROOT_B, "report", { kind: "project", id: "prj_b" }),
    "ses_b",
  );
  // 다른 그릇의 session은 같은 root라도 받지 않는다.
  assert.deepStrictEqual(find(ROOT_B, "report"), null);

  // 이름은 접두사 폴더로만 맞춘다: 비슷한 이름과 like 특수 문자는 맞지 않는다.
  assert.deepStrictEqual(find(ROOT_A, "repo"), null);
  assert.deepStrictEqual(find(ROOT_A, "rep%"), null);
  assert.deepStrictEqual(find(ROOT_A, "r_port"), null);

  // 닫힌 session과 다른 workspace의 쓰기는 건너뛰고 앞선 쓰기로 간다.
  write("ses_closed", ROOT_A, "report/new.html");
  write("ses_app", ROOT_A, "report/app.html");
  assert.deepStrictEqual(find(ROOT_A, "report"), "ses_a");

  // 앱이 owner면 앱 workspace의 session이 받고 project workspace의 session은 받지 않는다.
  assert.deepStrictEqual(find(ROOT_A, "report", APP), "ses_app");

  // 같은 그릇의 다른 agent session의 더 나중 쓰기가 이긴다.
  write("ses_op", ROOT_A, "report/op.html");
  assert.deepStrictEqual(find(ROOT_A, "report"), "ses_op");

  // 되돌려진 쓰기는 마지막으로 쓴 것이 아니다.
  sql.run("update rewind_files set reverted_by = 'rev_1' where path = ?", [
    "report/op.html",
  ]);
  assert.deepStrictEqual(find(ROOT_A, "report"), "ses_a");

  // 기록이 없으면 null이다.
  assert.deepStrictEqual(find(ROOT_A, "none"), null);
});

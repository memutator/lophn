import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ok } from "../../../../base/mod.ts";
import {
  archiveSession,
  deleteSession,
} from "../../../../protocol/lophn-agent/mod.ts";
import type {
  RequestContext,
  Sql,
  Tx,
} from "../../../../protocol/server/mod.ts";
import type { Writer } from "../../../storage/ledger/mod.ts";
import { conversationSchemaSteps } from "../model.ts";
import { turnSchemaSteps } from "../../run-loop/schema.ts";
import { toolsSchemaSteps } from "../../tools/model.ts";
import {
  createRewindStore,
  createSessionRewindCommands,
  installRestore,
  planRewind,
  prepareRestore,
  revertSchemaSteps,
} from "./mod.ts";
import { observeFiles } from "./prepare.ts";
import { requestApps, withRewindFiles } from "./files.ts";

const SESSION = "ses_00000000000000000000000001";
const user: RequestContext = {
  principal: "user",
  actor: "user",
  scope: { operations: [], targets: {} },
  conditions: {},
  credential_ref: "user",
};

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

// 실제 schema step 그대로인 표와 임시 폴더다.
function setup() {
  const db = new DatabaseSync(":memory:");
  // tool call 같은 앞 표의 행은 이 시험이 판정하지 않으므로 외래 키를 켜지 않는다.
  db.exec("pragma foreign_keys = off");
  for (const step of [
    ...conversationSchemaSteps,
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
  const tx = {
    sql,
    now: () => "2026-10-16T00:00:00.000Z",
    emit: () => 1,
  } as unknown as Tx;
  sql.run(
    `insert into sessions (id, agent, project, workspace_kind, workspace_id, created_seq, state_seq)
     values (?, 'agt_1', 'prj_1', 'project', 'prj_1', 1, 1)`,
    [SESSION],
  );
  // turn을 시작한 입력 메시지 둘이다. 둘 다 checkpoint다.
  for (const [id, seq] of [
    ["msg_1", 1],
    ["msg_2", 2],
  ] as const) {
    sql.run(
      `insert into messages (id, session, from_kind, body, created_seq, created_at, state_seq)
       values (?, ?, 'human', ?, ?, '2026-10-16T00:00:00.000Z', ?)`,
      [id, SESSION, sha(id), seq, seq],
    );
    sql.run("insert into checkpoints (message, session) values (?, ?)", [
      id,
      SESSION,
    ]);
  }
  return { sql, tx };
}

test("rewind는 고른 시점 뒤에 file tool로 바꾼 파일만 되돌리고 shell이 바꾼 파일은 그대로 둔다", async () => {
  const { sql, tx } = setup();
  const root = await mkdtemp(join(tmpdir(), "lophn-rewind-"));
  const data = await mkdtemp(join(tmpdir(), "lophn-rewind-store-"));
  try {
    const store = createRewindStore(data);
    // msg_1 turn이 쓴 d.txt, msg_2 turn이 쓴 a.txt(고침)와 c.txt(만듦), shell이 바꾼 b.txt(기록 없음)다.
    await writeFile(join(root, "d.txt"), "d-after");
    await writeFile(join(root, "a.txt"), "a-new");
    await writeFile(join(root, "c.txt"), "c-new");
    await writeFile(join(root, "b.txt"), "b-by-shell");
    let seq = 0;
    const record = async (
      checkpoint: string,
      path: string,
      before: string | null,
      after: string,
    ) => {
      const blob =
        before === null
          ? null
          : (await store.put(SESSION, new TextEncoder().encode(before))).key;
      sql.run(
        `insert into rewind_files
           (tool_call, root, path, checkpoint, seq, before_exists, before_sha256, before_blob,
            before_size, after_exists, after_sha256, moved_from, reverted_by)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, null, null)`,
        [
          `tcl_${path}`,
          root,
          path,
          checkpoint,
          ++seq,
          before === null ? 0 : 1,
          before === null ? null : sha(before),
          blob,
          before === null ? null : before.length,
          sha(after),
        ],
      );
    };
    await record("msg_1", "d.txt", "d-before", "d-after");
    await record("msg_2", "a.txt", "a-old", "a-new");
    await record("msg_2", "c.txt", null, "c-new");

    const target = {
      session: SESSION,
      checkpoint: "msg_2",
      choice: "restore_all" as const,
    };
    const first = planRewind(
      { sql },
      {
        observe: (files) => {
          const seen = new Map();
          for (const file of files) {
            for (const [path, stat] of observeFiles(file.root, [file.path])) {
              seen.set(path, stat);
            }
          }
          return seen;
        },
      },
      target,
    );
    assert.ok(first.ok);
    const files = await prepareRestore({
      store,
      session: SESSION,
      judged: first.value.judged,
      current: first.value.current,
    });
    const commands = createSessionRewindCommands({
      effects: { summaryOk: () => true, cancelWaiting: () => ok(undefined) },
    });
    const done = commands.rewind.handle(
      tx,
      user,
      {
        id: "rwd_1",
        session: SESSION,
        checkpoint: "msg_2",
        choice: "restore_all",
        accept_remaining: true,
        preview_hash: first.value.preview.preview_hash,
        summary_call: null,
        files,
        apps: [],
      } as never,
      {} as never,
    );
    assert.ok(done.ok);
    assert.deepStrictEqual(done.value.outcome, "applied");
    await installRestore({
      store,
      session: SESSION,
      judged: first.value.judged,
      prepared: files,
    });

    assert.deepStrictEqual(
      await readFile(join(root, "a.txt"), "utf8"),
      "a-old",
    );
    assert.deepStrictEqual(
      await readFile(join(root, "c.txt"), "utf8").catch(() => null),
      null,
    );
    // 고른 시점 앞의 기록과 기록 없는(shell) 파일은 그대로다.
    assert.deepStrictEqual(
      await readFile(join(root, "d.txt"), "utf8"),
      "d-after",
    );
    assert.deepStrictEqual(
      await readFile(join(root, "b.txt"), "utf8"),
      "b-by-shell",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(data, { recursive: true, force: true });
  }
});

test("apps를 고르지 않으면 앱 rewind를 요청하지 않고, 고르면 이 session의 첫 write invocation 직전으로 요청한다", async () => {
  const { sql } = setup();
  const asked: string[] = [];
  const recorded: unknown[] = [];
  const deps = {
    snapshot: <T>(read: (lookup: { sql: Sql }) => T) => ok(read({ sql })),
    apps: {
      writes: {
        writesAfter: () => [
          { app: "app_1", invocations: ["inv_3", "inv_2", "inv_4"] },
        ],
      },
      requestRewind: (app: string, from: string) => {
        asked.push(`${app}:${from}`);
        return Promise.resolve(
          ok({ status: "applied" as const, reason: null }),
        );
      },
    },
  };
  const writer = {
    command: (_ctx: unknown, envelope: { input: unknown }) => {
      recorded.push(envelope.input);
      return Promise.resolve(ok({}));
    },
  } as unknown as Writer;
  const input = {
    revert: "rwd_1",
    session: SESSION,
    checkpoint: "msg_2",
  };

  await requestApps(deps as never, writer, { ...input, apps: [] });
  assert.deepStrictEqual(asked, []);
  assert.deepStrictEqual(recorded, []);

  // 이 session이 write하지 않은 앱은 요청하지 않는다.
  await requestApps(deps as never, writer, {
    ...input,
    apps: ["app_1", "app_9"],
  });
  assert.deepStrictEqual(asked, ["app_1:inv_2"]);
  assert.deepStrictEqual(recorded.length, 1);
});

test("session을 지우면 그 session의 tool-results 폴더만 지우고 다른 session과 archive는 남긴다", async () => {
  const data = await mkdtemp(join(tmpdir(), "lophn-spill-"));
  try {
    for (const session of ["ses_a", "ses_b"]) {
      await mkdir(join(data, "tool-results", session), { recursive: true });
      await writeFile(join(data, "tool-results", session, "tcl_1.json"), "{}");
    }
    const writer = {
      command: async () => ok({ replayed: false, result: {} }),
    } as unknown as Writer;
    const files = withRewindFiles(writer, {
      snapshot: () => ok(undefined as never),
      store: createRewindStore(data),
      dataRoot: data,
      apps: {} as never,
    });
    const send = (command: string, session: string) =>
      files.command(
        { ...user, actor: "user" } as never,
        {
          command,
          input: { session },
          idempotency_key: command,
          compare: {},
          prepared: [],
        } as never,
      );
    await send(archiveSession.name, "ses_a");
    await stat(join(data, "tool-results", "ses_a", "tcl_1.json"));
    await send(deleteSession.name, "ses_a");
    await assert.rejects(stat(join(data, "tool-results", "ses_a")));
    await stat(join(data, "tool-results", "ses_b", "tcl_1.json"));
  } finally {
    await rm(data, { recursive: true, force: true });
  }
});

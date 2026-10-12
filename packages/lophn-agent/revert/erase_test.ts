import { assert, assertEquals } from "@std/assert";
import { deleteSessionReverts, eraseSessionStore } from "./erase.ts";
import { agentWrite, doRewind, type Env, openEnv } from "./testing/flow.ts";
import {
  MSG,
  must,
  OTHER_SES,
  RVT,
  SES,
  TCL,
  writeProjectFile,
} from "./testing/mod.ts";
import { existsSync } from "node:fs";
import { join } from "node:path";

// session을 delete하거나 닫을 때의 정리(agent-RW3d). 네 표와 session 저장소를 함께 본다.

const TABLES = [
  "checkpoints",
  "rewind_files",
  "reverts",
  "revert_items",
] as const;

function counts(env: Env, session: string): number[] {
  const where = {
    checkpoints: "session = ?",
    rewind_files:
      "checkpoint in (select message from checkpoints where session = ?)",
    reverts: "session = ?",
    revert_items: "revert in (select id from reverts where session = ?)",
  } as const;
  return TABLES.map((table) =>
    Number(
      env.world.query(
        `select count(*) as n from ${table} where ${where[table]}`,
        [session],
      )[0]!["n"],
    )
  );
}

// 두 session에 각각 요청 하나, 파일 쓰기 하나, rewind 하나가 있다.
async function twoSessions(): Promise<Env> {
  const env = openEnv();
  env.world.addSession(OTHER_SES);
  let n = 0;
  for (const session of [SES, OTHER_SES]) {
    n += 1;
    const { run } = env.world.addRequest(n, { session });
    env.world.addToolCall(n, run);
    writeProjectFile(env.root, `f${n}.md`, "before");
    // 기록은 agent 자격으로 session의 run 아래에 남는다.
    must(
      await agentWrite(env, {
        session,
        tool_call: TCL(n),
        run,
        path: `f${n}.md`,
        content: "after",
      }),
    );
  }
  // session SES에는 rewind도 있다.
  must(
    await doRewind(env, {
      id: RVT(1),
      checkpoint: MSG(1),
      choice: "restore_all",
    }),
  );
  return env;
}

Deno.test("lophn-agent/revert#R20 [agent-RW3d]: deleting a session removes the four tables' rows for it and keeps every other session's", async () => {
  const env = await twoSessions();
  const kept = counts(env, OTHER_SES);
  assertEquals(kept.slice(0, 2).every((count) => count > 0), true);
  const before = counts(env, SES);
  assertEquals(before.slice(0, 3).every((count) => count > 0), true);
  env.world.db.exec("begin");
  must(deleteSessionReverts(env.world.tx, SES));
  env.world.db.exec("commit");
  assertEquals(counts(env, SES), [0, 0, 0, 0]);
  assertEquals(counts(env, OTHER_SES), kept);
  // 메시지는 이 정리의 대상이 아니다(DeleteSession이 따로 지운다).
  assertEquals(
    Number(env.world.query("select count(*) as n from messages")[0]!["n"]),
    2,
  );
});

Deno.test("lophn-agent/revert#R20 [agent-RW3d]: the session directory is removed after the commit, and a failing removal is reported without throwing", async () => {
  const env = await twoSessions();
  const dir = join(env.dataRoot, "rewind", SES);
  assert(existsSync(dir));
  assertEquals(await eraseSessionStore(env.store, SES), true);
  assert(!existsSync(dir));
  // 이미 없는 디렉터리는 성공이다.
  assertEquals(await eraseSessionStore(env.store, SES), true);
  // 지우기에 실패하면 던지지 않고 false를 돌려준다(시작 때와 주기로 다시 쓸어낸다).
  const failing = {
    removeSession: () => Promise.reject(new Error("busy")),
  };
  assertEquals(await eraseSessionStore(failing, SES), false);
  // 다른 session의 저장물은 남는다.
  assert(existsSync(join(env.dataRoot, "rewind", OTHER_SES)));
});

Deno.test("lophn-agent/revert#R20 [agent-RW3d]: after the cleanup nothing of the session can be rewound", async () => {
  const env = await twoSessions();
  env.world.db.exec("begin");
  must(deleteSessionReverts(env.world.tx, SES));
  env.world.db.exec("commit");
  assertEquals(counts(env, SES), [0, 0, 0, 0]);
  assertEquals(
    env.world.query("select count(*) as n from checkpoints where message = ?", [
      MSG(1),
    ])[0]!["n"],
    0,
  );
});

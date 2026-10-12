import { assert, assertEquals } from "@std/assert";
import { existsSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { liveStoreKeys, sweepRewindStore } from "./sweep.ts";
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

// 저장소 쓸기(agent-RW3d). 저장물 설치와 row 등록은 공동 원자 작업이 아니라 row가 없는 고아가 남을 수 있다.

const encode = (text: string) => new TextEncoder().encode(text);

// 사람 요청 M1이 a.md를 쓰고(a0 → a1) rewind로 되돌린 상태다.
async function rewound(): Promise<Env> {
  const env = openEnv();
  const first = env.world.addRequest(1);
  env.world.addToolCall(1, first.run);
  writeProjectFile(env.root, "a.md", "a0");
  must(
    await agentWrite(env, {
      tool_call: TCL(1),
      run: first.run,
      path: "a.md",
      content: "a1",
    }),
  );
  must(
    await doRewind(env, {
      id: RVT(1),
      checkpoint: MSG(1),
      choice: "restore_all",
    }),
  );
  return env;
}

const sweepOf = (env: Env, skipNewerThan = Date.now() + 60_000) =>
  sweepRewindStore({
    store: env.store,
    snapshot: (read) => read(env.world.lookup),
    skipNewerThan,
  });

Deno.test("lophn-agent/revert#R20 [agent-RW3d]: the stored pre-images and the redo copies of a rewind that can still be redone are live", async () => {
  const env = await rewound();
  const live = liveStoreKeys(env.world.lookup, SES);
  assertEquals(live.size, 2);
  assertEquals(liveStoreKeys(env.world.lookup, OTHER_SES).size, 0);
  // redo가 확정되면 복원 직전 내용은 더 쓰지 않는다.
  env.world.db.exec("update reverts set redo = 'closed'");
  assertEquals(liveStoreKeys(env.world.lookup, SES).size, 1);
});

Deno.test("lophn-agent/revert#R20 [agent-RW3d]: the sweep removes a stored file no row points at and keeps the live ones", async () => {
  const env = await rewound();
  const orphan = (await env.store.put(SES, encode("orphan"))).key;
  const result = await sweepOf(env);
  assertEquals(result.orphans, 1);
  assertEquals(result.sessions, []);
  assert(!await env.store.has(SES, orphan));
  for (const key of liveStoreKeys(env.world.lookup, SES)) {
    assert(await env.store.has(SES, key));
  }
});

Deno.test("lophn-agent/revert#R20 [agent-RW3d]: a file made after the cutoff is kept because its row may not be registered yet", async () => {
  const env = await rewound();
  const fresh = (await env.store.put(SES, encode("not yet registered"))).key;
  const result = await sweepOf(env, Date.now() - 60_000);
  assertEquals(result.orphans, 0);
  assert(await env.store.has(SES, fresh));
  // 오래된 파일이면 같은 쓸기가 지운다.
  const old = new Date(Date.now() - 3_600_000);
  utimesSync(join(env.dataRoot, "rewind", SES, fresh), old, old);
  assertEquals((await sweepOf(env, Date.now() - 60_000)).orphans, 1);
});

Deno.test("lophn-agent/revert#R20 [agent-RW3d]: putting a stored content again refreshes it so a sweep does not take it away", async () => {
  const env = openEnv();
  const key = (await env.store.put(SES, encode("shared"))).key;
  const old = new Date(Date.now() - 3_600_000);
  utimesSync(join(env.dataRoot, "rewind", SES, key), old, old);
  await env.store.put(SES, encode("shared"));
  assertEquals((await sweepOf(env, Date.now() - 60_000)).orphans, 0);
  assert(await env.store.has(SES, key));
});

Deno.test("lophn-agent/revert#R20 [agent-RW3d]: the directory of a closed or vanished session is removed whole, an open one stays", async () => {
  const env = openEnv();
  env.world.addSession(OTHER_SES, "closed");
  await env.store.put(SES, encode("open"));
  await env.store.put(OTHER_SES, encode("closed"));
  await env.store.put("ses_000000000000000000000000f3", encode("vanished"));
  const result = await sweepOf(env);
  assertEquals(
    result.sessions.sort(),
    [
      OTHER_SES,
      "ses_000000000000000000000000f3",
    ].sort(),
  );
  assert(existsSync(join(env.dataRoot, "rewind", SES)));
  assert(!existsSync(join(env.dataRoot, "rewind", OTHER_SES)));
});

Deno.test("lophn-agent/revert#R20 [agent-RW3d]: one session that cannot be swept does not stop the others", async () => {
  const env = openEnv();
  env.world.addSession(OTHER_SES, "closed");
  await env.store.put(OTHER_SES, encode("closed"));
  const store = {
    sessions: () => Promise.resolve([SES, OTHER_SES]),
    sweep: () => Promise.reject(new Error("busy")),
    removeSession: env.store.removeSession,
  };
  const result = await sweepRewindStore({
    store,
    snapshot: (read) => read(env.world.lookup),
    skipNewerThan: Date.now(),
  });
  assertEquals(result.sessions, [OTHER_SES]);
});

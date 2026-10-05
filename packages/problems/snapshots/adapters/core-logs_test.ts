import { assert, assertEquals } from "@std/assert";
import {
  type CoreCall,
  coreLogSource,
  DETAIL_COLLECTION_SETTING_KEY,
  readDetailCollection,
} from "./core-logs.ts";

const APP = "app_01arz3ndektsv4rrffq69g5fav";

function client(
  respond: (path: string, body: unknown) => { status: number; body: unknown },
): { call: CoreCall; seen: { path: string; body: unknown }[] } {
  const seen: { path: string; body: unknown }[] = [];
  return {
    seen,
    call: {
      baseUrl: "http://127.0.0.1:1/",
      credential: "token",
      fetch: (input, init) => {
        const path = new URL(input).pathname;
        const body = JSON.parse(init.body);
        seen.push({ path, body });
        const answer = respond(path, body);
        return Promise.resolve({
          status: answer.status,
          bytes: new TextEncoder().encode(JSON.stringify(answer.body)),
        });
      },
    },
  };
}

Deno.test("problems/snapshots#R12: core의 apps.logs 응답을 그대로 읽고 contract 밖 응답은 unavailable이다", async () => {
  const good = client(() => ({
    status: 200,
    body: {
      as_of_seq: "1",
      next_cursor: null,
      state: "ok",
      lines: ["a"],
      collected_at: "2026-10-04T12:00:00.000Z",
      truncated: false,
    },
  }));
  const read = await coreLogSource(good.call)({
    app: APP,
    limit: 30,
    max_bytes: 65_536,
  });
  assert(read.ok);
  assertEquals(read.value.lines, ["a"]);
  assertEquals(good.seen[0]!.path, "/v1/apps/logs");
  assertEquals(good.seen[0]!.body, { app: APP, limit: 30, max_bytes: 65_536 });

  for (
    const bad of [
      { status: 200, body: { state: "weird" } },
      { status: 403, body: { error: { code: "forbidden", message: "x" } } },
    ]
  ) {
    const read = await coreLogSource(client(() => bad).call)({
      app: APP,
      limit: 30,
      max_bytes: 65_536,
    });
    assert(!read.ok);
    assertEquals(read.error.code, "unavailable");
  }
});

Deno.test("problems/snapshots#R7: 진단 상세 수집 설정은 boolean 값만 읽고 나머지는 모름(null)이다", async () => {
  const answer = (value: unknown, resolved = true) =>
    client(() => ({
      status: 200,
      body: {
        revision: 1,
        settings: [{ key: DETAIL_COLLECTION_SETTING_KEY, resolved, value }],
      },
    }));
  const off = answer(false);
  assertEquals(await readDetailCollection(off.call), false);
  assertEquals(off.seen[0]!.path, "/v1/settings/get");
  assertEquals(off.seen[0]!.body, { keys: [DETAIL_COLLECTION_SETTING_KEY] });
  assertEquals(await readDetailCollection(answer(true).call), true);
  assertEquals(await readDetailCollection(answer("no").call), null);
  assertEquals(
    await readDetailCollection(client(() => ({ status: 500, body: {} })).call),
    null,
  );
  assertEquals(
    await readDetailCollection(client(() => ({ status: 200, body: {} })).call),
    null,
  );
});

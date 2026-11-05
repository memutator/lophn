import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";
import { ok } from "../../base/mod.ts";
import { APP_COMMANDS } from "./app.ts";
import type { CommandContext } from "./types.ts";

const APP = "app_01hzzzzzzzzzzzzzzzzzzzzzza";
const find = (name: string) => APP_COMMANDS.find((c) => c.name === name)!;

// 요약은 state 객체가 아니라 상태 이름을 보이고, unavailable이면 그 이유도 보인다.
test("app.status 요약이 상태 이름과 이유를 보이고 [object Object]를 싣지 않는다", async () => {
  const cases = [
    {
      state: { state: "running", termination_pending: false },
      shows: ["running"],
    },
    {
      state: {
        state: "unavailable",
        termination_pending: false,
        reason: { code: "crash_loop", summary: "exits exceeded five" },
      },
      shows: ["unavailable", "crash_loop", "exits exceeded five"],
    },
  ];
  for (const item of cases) {
    const ran = await find("app.status").run({ app: APP }, {
      core: {
        read: () =>
          Promise.resolve(
            ok({
              app: APP,
              state: item.state,
              as_of_seq: "1",
              next_cursor: null,
            }),
          ),
      },
    } as unknown as CommandContext);
    assert.ok(ran.ok);
    for (const shows of item.shows) {
      assert.ok(ran.value.summary.includes(shows), ran.value.summary);
    }
    assert.ok(!ran.value.summary.includes("[object Object]"));
  }
});

// 상대 path를 기준 폴더로 풀지 않으면 core가 core의 cwd로 읽어 엉뚱한 폴더를 앱 source로 잇는다.
test("app.link_source는 상대 path를 context의 기준 폴더로 풀어 core에 보낸다", async () => {
  const sent: unknown[] = [];
  const ctx = {
    cwd: "/work/workspace",
    key: "k",
    core: {
      read: () => Promise.resolve(ok({ app: { revision: "3" } })),
      command: (_route: unknown, input: unknown) => {
        sent.push(input);
        return Promise.resolve(ok({}));
      },
    },
  } as unknown as CommandContext;
  const link = find("app.link_source");
  await link.run({ app: APP, path: "../src/a" }, ctx);
  await link.run({ app: APP, path: "/abs/b" }, ctx);
  assert.deepStrictEqual(
    sent.map((i) => (i as { source_path: string }).source_path),
    // Windows는 드라이브가 붙는다.
    [resolve("/work/src/a"), resolve("/abs/b")],
  );
});

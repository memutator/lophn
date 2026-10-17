// contract: coding-agent-cli-interface. coding agent가 core에 닿는 길은 CLI 하나이고 인증은 token이다.
// 현실적 회귀: CLI 입력 검사가 바뀌어 coding agent가 ticket을 claim하지 못하는 것.
// 왜 지금 못 잡나: CLI는 main_test가 가짜 fetch로 hook만 본다. 앱 E2E가 CLI를 쓰는 길(JSON 출력, 종료 코드)은 여기서 한 번 본다.
import { assertEquals } from "@std/assert";
import type { RpcFetch } from "../../../packages/protocol/client/mod.ts";
import type { Core } from "../core/mod.ts";
import { codingCli } from "./cli.ts";

const core = { baseUrl: "http://127.0.0.1:1" } as Core;

function reply(status: number, body: unknown): RpcFetch {
  return () =>
    Promise.resolve({
      status,
      headers: new Headers(),
      bytes: new TextEncoder().encode(JSON.stringify(body)),
    });
}

Deno.test("codingCli는 route 출력을 value로, 실패를 종료 코드와 error value로 돌려준다", async () => {
  const body = { tickets: [], as_of_seq: "3", next_cursor: null };
  const ok = await codingCli(core, "tok", reply(200, body)).run("ticket list");
  assertEquals([ok.code, ok.value], [0, body]);

  const bad = await codingCli(
    core,
    "tok",
    reply(404, { error: { code: "not_found", message: "x" } }),
  ).run("ticket list");
  assertEquals(bad.code !== 0, true);
  assertEquals(
    (bad.value as { error: { code: string } }).error.code,
    "not_found",
  );
});

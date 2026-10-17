import { assertEquals } from "@std/assert";
import { routePath } from "../../protocol/base/mod.ts";
import { releasePreparation } from "../../protocol/apps/mod.ts";
import {
  getTestRequest,
  getVerification,
} from "../../protocol/problems/mod.ts";
import { cliMain } from "./main.ts";

function sink(): { stream: WritableStream<Uint8Array>; text(): string } {
  const chunks: string[] = [];
  const decoder = new TextDecoder();
  return {
    stream: new WritableStream({
      write(chunk) {
        chunks.push(decoder.decode(chunk));
      },
    }),
    text: () => chunks.join(""),
  };
}

Deno.test("hook CLI는 token이 없으면 아무것도 보내지 않고 stdin도 읽지 않고 조용히 성공한다", async () => {
  const stdout = sink();
  const stderr = sink();
  let sent = false;
  let read = false;
  const code = await cliMain(["hook", "claude", "Stop"], {
    env: { get: (name) => name === "LOPHN_HOME" ? "/nonexistent" : undefined },
    fetch: () => {
      sent = true;
      return Promise.reject(new Error("must not send"));
    },
    stdin: () => {
      read = true;
      return Promise.resolve("{}");
    },
    stdout: stdout.stream,
    stderr: stderr.stream,
  });
  assertEquals(code, 0);
  assertEquals([stdout.text(), stderr.text()], ["", ""]);
  assertEquals([sent, read], [false, false]);
});

// contract: coding agent가 core에 닿는 길은 CLI 하나이고 준비 → 확정 → 보고가 CLI로 끝까지 간다(coding-agent-cli-interface).
// 현실적 회귀: CLI 표와 route가 어긋나 coding agent가 release 확정이나 test 결과 읽기에서 막힌다.
// 왜 지금 못 잡나: 준비부터 report까지 한 길로 가는 test가 없고 앱 E2E가 처음 한다.
Deno.test("release와 app test를 읽는 명령은 표의 route에 닿는다", async () => {
  const app = "app_00000000000000000000000000";
  const cases: [string[], { resource: string; method: string }][] = [
    [[
      "release",
      "status",
      "--input",
      JSON.stringify({ app, request_key: "k" }),
    ], releasePreparation],
    [
      ["app", "test", "status", "--input", '{"request_key":"k"}'],
      getTestRequest,
    ],
    [
      [
        "app",
        "test",
        "result",
        "--input",
        JSON.stringify({
          verification: "vrf_00000000000000000000000000",
          detail: false,
        }),
      ],
      getVerification,
    ],
  ];
  for (const [argv, route] of cases) {
    const urls: string[] = [];
    await cliMain(argv, {
      env: {
        get: (name) =>
          name === "LOPHN_CODING_TOKEN"
            ? "token"
            : name === "LOPHN_DAEMON_URL"
            ? "http://127.0.0.1:1"
            : undefined,
      },
      fetch: (url) => {
        urls.push(url);
        return Promise.resolve({
          status: 404,
          headers: new Headers(),
          bytes: new Uint8Array(),
        });
      },
      stdout: sink().stream,
      stderr: sink().stream,
    });
    assertEquals(urls, [`http://127.0.0.1:1${routePath(route)}`]);
  }
});

import { assertEquals, assertStringIncludes } from "@std/assert";
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

// contract: `app`이 필수인 token 명령은 core가 token에서 채워 주지 않으므로 `app` 없이 보내지 않고 CLI가 칸 이름으로 알린다(coding-agent-cli-interface).
// 현실적 회귀: `app`이 선택으로 보여 coding agent가 비운 채 부르고, 이름 없는 core 오류만 받아 막힌다.
// 왜 지금 못 잡나: 위 행은 `app`을 넣어 부른다.
Deno.test("app이 필수인 token 명령은 app 없이 부르면 보내지 않고 app 칸을 짚는다", async () => {
  const stderr = sink();
  let sent = false;
  const code = await cliMain(["app", "show"], {
    env: {
      get: (name) =>
        name === "LOPHN_CODING_TOKEN"
          ? "coding-secret"
          : name === "LOPHN_DAEMON_URL"
          ? "http://127.0.0.1:1"
          : undefined,
    },
    fetch: () => {
      sent = true;
      return Promise.reject(new Error("must not send"));
    },
    stdout: sink().stream,
    stderr: stderr.stream,
  });
  assertEquals([code, sent], [2, false]);
  assertStringIncludes(stderr.text(), "app");
});

// 현실적 회귀: route 입력의 `input` 칸이 CLI 공통 key `input`과 이름이 같아 지워져 core가 늘 `{}`를 받았다(손 확인에서 두 번 고친 길).
Deno.test("app preview start는 route 입력의 input 칸을 지우지 않고 그대로 보낸다", async () => {
  const input = {
    app: "app_00000000000000000000000000",
    bundle_hash: "a".repeat(64),
    release: null,
    fixture_hash: null,
  };
  let sent: unknown;
  await cliMain(
    ["app", "preview", "start", "--input", JSON.stringify({ input })],
    {
      env: {
        get: (name) =>
          name === "LOPHN_CODING_TOKEN"
            ? "token"
            : name === "LOPHN_DAEMON_URL"
            ? "http://127.0.0.1:1"
            : undefined,
      },
      fetch: (_url, init) => {
        sent = JSON.parse(init.body ?? "null");
        return Promise.resolve({
          status: 404,
          headers: new Headers(),
          bytes: new Uint8Array(),
        });
      },
      stdout: sink().stream,
      stderr: sink().stream,
    },
  );
  assertEquals(sent, { input });
});

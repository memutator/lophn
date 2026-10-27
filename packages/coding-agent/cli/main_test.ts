import assert from "node:assert/strict";
import { test } from "node:test";

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

test("hook CLI는 LPN_TERMINAL_HOOK이 없으면 아무것도 보내지 않고 stdin도 읽지 않고 조용히 성공한다", async () => {
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
  assert.deepStrictEqual(code, 0);
  assert.deepStrictEqual([stdout.text(), stderr.text()], ["", ""]);
  assert.deepStrictEqual([sent, read], [false, false]);
});

// contract: `app`이 필수인 token 명령은 core가 token에서 채워 주지 않으므로 `app` 없이 보내지 않고 CLI가 칸 이름으로 알린다(coding-agent-cli-interface).
// 현실적 회귀: `app`이 선택으로 보여 coding agent가 비운 채 부르고, 이름 없는 core 오류만 받아 막힌다.
// 왜 지금 못 잡나: 위 행은 `app`을 넣어 부른다.
test("app이 필수인 token 명령은 app 없이 부르면 보내지 않고 app 칸을 짚는다", async () => {
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
  assert.deepStrictEqual([code, sent], [2, false]);
  assert.ok(stderr.text().includes("app"), stderr.text());
});

// 현실적 회귀: route 입력의 `input` 칸이 CLI 공통 key `input`과 이름이 같아 지워져 core가 늘 `{}`를 받았다(손 확인에서 두 번 고친 길).
test("app preview start는 route 입력의 input 칸을 지우지 않고 그대로 보낸다", async () => {
  const input = {
    app: "app_00000000000000000000000000",
    bundle_hash: "a".repeat(64),
    release: null,
    fixture: null,
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
  assert.deepStrictEqual(sent, { input });
});

// contract: user token file에서 읽은 token은 stdout·stderr(오류 포함)에 나오지 않는다(coding-agent-cli-interface).
// 현실적 회귀: core 오류 message나 run 결과가 token을 되비추면 사람의 터미널과 script log에 사람의 자격이 남는다.
// 왜 지금 못 잡나: 위 행은 coding token만 쓴다. user token은 CLI가 file에서 읽어 와 `secrets`에 따로 넣어야 한다.
const FILE_TOKEN = "file-token-secret";
const RUN_ID = "run_00000000000000000000000000";

function runRecord(result: string) {
  return {
    id: RUN_ID,
    kind: "agent",
    target: { agent: { role: "lophn" } },
    session: null,
    session_opened: false,
    input_message: null,
    turn: null,
    invocation: null,
    schema: null,
    state: "done",
    result,
    error: null,
    created_at: "2026-10-22T00:00:00.000Z",
    finished_at: "2026-10-22T00:00:01.000Z",
    state_seq: "1",
    as_of_seq: "1",
    next_cursor: null,
  };
}

for (const json of [true, false]) {
  for (const fails of [true, false]) {
    test(`user token으로 부른 run show는 token을 출력에 남기지 않는다 (json=${json}, 오류=${fails})`, async () => {
      const stdout = sink();
      const stderr = sink();
      let authorization: string | undefined;
      await cliMain(["run", "show", RUN_ID, ...(json ? ["--json"] : [])], {
        env: {
          get: (name) => name === "LOPHN_HOME" ? "/fake-home" : undefined,
        },
        readText: (path) =>
          path === "/fake-home/run/user-token" ? FILE_TOKEN : undefined,
        fetch: (_url, init) => {
          authorization = init.headers.authorization;
          const body = fails
            ? { error: { code: "conflict", message: `bad ${FILE_TOKEN}` } }
            : runRecord(`echo ${FILE_TOKEN}`);
          return Promise.resolve({
            status: fails ? 409 : 200,
            headers: new Headers(),
            bytes: new TextEncoder().encode(JSON.stringify(body)),
          });
        },
        stdout: stdout.stream,
        stderr: stderr.stream,
      });
      assert.deepStrictEqual(authorization, `Bearer ${FILE_TOKEN}`);
      assert.deepStrictEqual(
        (stdout.text() + stderr.text()).includes(FILE_TOKEN),
        false,
      );
    });
  }
}

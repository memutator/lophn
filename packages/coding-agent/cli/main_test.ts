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
    env: {
      get: (name) => (name === "LOPHN_HOME" ? "/nonexistent" : undefined),
    },
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

// contract: user token file에서 읽은 token은 stdout·stderr(오류 포함)에 나오지 않는다(coding-agent-cli-interface).
// 현실적 회귀: core 오류 message나 run 결과가 token을 되비추면 사람의 터미널과 script log에 사람의 자격이 남는다.
const FILE_TOKEN = "file-token-secret";
const RUN_ID = "run_00000000000000000000000000";

function runRecord(result: string) {
  return {
    id: RUN_ID,
    kind: "agent",
    target: { agent: { agent: "lophn", place: null } },
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
          get: (name) => (name === "LOPHN_HOME" ? "/fake-home" : undefined),
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

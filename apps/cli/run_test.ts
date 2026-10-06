// CLI 실행 조립 시험이다(cli#R1, R2, R40, connection#R5·R6·R17). helper는 temp dir의 sh script 대역이고 core
// 응답은 주입한 fetch다. 사람의 실제 keychain·data root·harness 설정은 열지 않는다.
import { assert, assertEquals, assertFalse } from "@std/assert";
import { createHelperCredentialProvider } from "../../packages/coding-agent/connection/credential/helper.ts";
import { UNREADABLE_MESSAGE } from "../../packages/coding-agent/connection/unreadable.ts";
import { cliMain, type CliOptions } from "./main.ts";

const CAC = "cac_01h455vb4pex5v6nkc6gd5fdw1";
const TOKEN = "cli-delivered-token-33bd90";

async function fakeHelper(body: string): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: "lophn-cli-helper-" });
  const helper = `${dir}/lophn-credential`;
  await Deno.writeTextFile(helper, `#!/bin/sh\ncat > /dev/null\n${body}\n`);
  await Deno.chmod(helper, 0o755);
  return helper;
}

async function removeHelper(helper: string): Promise<void> {
  await Deno.remove(helper.slice(0, helper.lastIndexOf("/")), {
    recursive: true,
  });
}

type Captured = { exit: number; stdout: string; stderr: string };

async function run(argv: string[], options: CliOptions): Promise<Captured> {
  const out = new TransformStream<Uint8Array, Uint8Array>();
  const err = new TransformStream<Uint8Array, Uint8Array>();
  const decoder = new TextDecoder();
  const collect = async (readable: ReadableStream<Uint8Array>) => {
    let text = "";
    for await (const chunk of readable) {
      text += decoder.decode(chunk, { stream: true });
    }
    return text;
  };
  const stdout = collect(out.readable);
  const stderr = collect(err.readable);
  const exit = await cliMain(argv, {
    stdout: out.writable,
    stderr: err.writable,
    cwd: Deno.cwd(),
    home: "/nonexistent-home",
    installRoot: "/nonexistent-install",
    ...options,
  });
  await out.writable.close();
  await err.writable.close();
  return { exit, stdout: await stdout, stderr: await stderr };
}

const ENV = (extra: Record<string, string> = {}) => ({
  get: (name: string) =>
    ({ LOPHN_HOME: "/nonexistent-lophn-home", ...extra })[name],
});

function reply(body: unknown, status = 200) {
  return Promise.resolve({
    status,
    headers: new Headers(),
    bytes: new TextEncoder().encode(JSON.stringify(body)),
  });
}

const USER_TARGET = {
  scope_kind: "user",
  environment: { kind: "host", identity: "x" },
  profile_id: null,
  harness_id: "claude",
  app: null,
  app_realpath: null,
};

Deno.test("coding-agent/cli#R1 coding-agent/connection#R6: CLI는 command 표의 소유 route를 같은 core client로 부르고 helper에서 받은 token을 쓰되 출력에는 남기지 않는다", async () => {
  const helper = await fakeHelper(`printf '%s' '{"token":"${TOKEN}"}'`);
  const seen: { url: string; auth: string }[] = [];
  try {
    const result = await run(
      ["document", "list", "--connection", CAC, "--json"],
      {
        env: ENV(),
        provider: createHelperCredentialProvider({
          helper,
          generation: () => "1",
        }),
        fetch: (url, init) => {
          seen.push({ url, auth: init.headers["authorization"] ?? "" });
          return reply({
            documents: [],
            as_of_seq: "1",
            next_cursor: null,
          });
        },
      },
    );
    assertEquals(result.exit, 0, result.stderr);
    assertEquals(seen.length, 1);
    assert(seen[0].url.endsWith("/v1/documents/list"), seen[0].url);
    assertEquals(seen[0].auth, `Bearer ${TOKEN}`);
    assertFalse(result.stdout.includes(TOKEN));
    assertFalse(result.stderr.includes(TOKEN));
    assert(result.stdout.includes('"documents"'));
  } finally {
    await removeHelper(helper);
  }
});

Deno.test("coding-agent/connection#R17 coding-agent/cli#R2: keychain가 잠기면 core를 부르지 않고 이유가 있는 unavailable이며 transport exit다", async () => {
  const helper = await fakeHelper(`printf '%s' '{"reason":"locked"}'\nexit 1`);
  let calls = 0;
  try {
    const result = await run(
      ["document", "list", "--connection", CAC, "--json"],
      {
        env: ENV(),
        provider: createHelperCredentialProvider({
          helper,
          generation: () => "1",
        }),
        fetch: () => {
          calls += 1;
          return Promise.reject(new Error("core에 닿으면 안 된다"));
        },
      },
    );
    assertEquals(result.exit, 5);
    assertEquals(calls, 0);
    assert(result.stdout.includes("locked"), result.stdout);
    assertFalse(/Bearer|"token"/.test(result.stdout));
  } finally {
    await removeHelper(helper);
  }
});

Deno.test("coding-agent/connection#R5 coding-agent/connection#R6: 범위 밖·없는 대상의 not_found는 같은 통일 메시지다", async () => {
  const helper = await fakeHelper(`printf '%s' '{"token":"${TOKEN}"}'`);
  try {
    const result = await run(
      [
        "document",
        "history",
        "--connection",
        CAC,
        "--json",
        "--input",
        '{"document":"doc_01arz3ndektsv4rrffq69g5fav"}',
      ],
      {
        env: ENV(),
        provider: createHelperCredentialProvider({
          helper,
          generation: () => "1",
        }),
        fetch: () =>
          reply({
            error: { code: "not_found", message: "다른 앱의 문서 제목" },
          }, 404),
      },
    );
    assertEquals(result.exit, 4);
    assert(result.stdout.includes(UNREADABLE_MESSAGE), result.stdout);
    assertFalse(result.stdout.includes("다른 앱의 문서 제목"));
  } finally {
    await removeHelper(helper);
  }
});

Deno.test("coding-agent/cli#R40 coding-agent/connection#R2: 연결 참조 환경으로 시작한 coding credential은 연결 설치를 거절하고 연결 생성·회수는 사람 화면 안내다", async () => {
  const denied = await run(
    [
      "connection",
      "install",
      "--connection",
      CAC,
      "--json",
      "--input",
      JSON.stringify({ target: USER_TARGET }),
    ],
    { env: ENV({ LOPHN_CONNECTION: CAC }) },
  );
  assertEquals(denied.exit, 3);
  assert(denied.stdout.includes("사람 전용"));
  const created = await run(
    [
      "connection",
      "create",
      "--json",
      "--input",
      JSON.stringify({ label: "claude", scope: { kind: "all", app: null } }),
    ],
    { env: ENV() },
  );
  assertEquals(created.exit, 4);
  assert(created.stdout.includes("human_only"));
});

Deno.test("coding-agent/cli#R2: 연결 참조가 없으면 core를 부르는 command는 invalid_input이고 ticket claim은 MCP 안내다", async () => {
  const none = await run(["document", "list", "--json"], { env: ENV() });
  assertEquals(none.exit, 2);
  const claim = await run(
    [
      "ticket",
      "claim",
      "--connection",
      CAC,
      "--json",
      "--input",
      '{"ticket":"tkt_01arz3ndektsv4rrffq69g5fav"}',
    ],
    { env: ENV() },
  );
  assertEquals(claim.exit, 4);
  assert(claim.stdout.includes("mcp_only"));
});

Deno.test("coding-agent/cli#R5: 쓰기 응답을 잃으면 실제 오류와 구별한 effect_unknown(exit 6)이고 자동으로 다시 실행하지 않는다", async () => {
  const helper = await fakeHelper(`printf '%s' '{"token":"${TOKEN}"}'`);
  const sent: string[] = [];
  try {
    const result = await run(
      [
        "app",
        "register",
        "--connection",
        CAC,
        "--json",
        "--idempotency-key",
        "cli-key-1",
        "--input",
        '{"slug":"notes","name":"Notes","description":"한 줄 목적"}',
      ],
      {
        env: ENV(),
        provider: createHelperCredentialProvider({
          helper,
          generation: () => "1",
        }),
        fetch: (url) => {
          sent.push(url);
          return Promise.reject(new Error("연결이 끊겼다"));
        },
      },
    );
    assertEquals(result.exit, 6, result.stdout + result.stderr);
    assert(result.stdout.includes("effect_unknown"), result.stdout);
    assertFalse(result.stdout.includes(TOKEN));
    // 사람이 준 key가 그대로 남아 같은 key로 결과를 다시 읽을 수 있다.
    assert(result.stdout.includes("cli-key-1"), result.stdout);
    // 쓰기는 한 번 보냈고 같은 key로 결과를 다시 읽을 뿐 새 쓰기를 만들지 않는다.
    assertEquals(
      sent.filter((url) => url.endsWith("/v1/apps/create")).length,
      1,
    );
  } finally {
    await removeHelper(helper);
  }
});

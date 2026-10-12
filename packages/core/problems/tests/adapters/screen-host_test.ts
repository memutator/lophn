import { assertEquals, assertFalse } from "@std/assert";
import type { ScreenTestInput } from "../../../../protocol/shell/mod.ts";
import {
  runScreenHost,
  SCREEN_OBSERVATION_MAX_BYTES,
  screenErrorBoundaries,
} from "./screen-host.ts";
import { serveTestAppSocket } from "./test-app-socket.ts";

const OBSERVATION = JSON.stringify({
  load: [{ screen: "main", ok: true, reason: null }],
  errors: [],
  feedback_check: [],
  blocked_requests: [],
});

function inputFor(socket: string): ScreenTestInput {
  return {
    bundle_screens_dir: "/nonexistent-bundle",
    screens: [{ key: "main", path: "main/index.html" }],
    app_socket_path: socket,
    deadline_ms: 5_000,
  };
}

// fd 3에서 입력 한 줄을 읽고 script가 정한 대로 쓰고 끝나는 가짜 host 실행 파일.
async function fakeHost(dir: string, body: string): Promise<string> {
  const path = `${dir}/host.sh`;
  await Deno.writeTextFile(
    path,
    `#!/bin/sh\nread line <&3\necho "$line" > "$TMPDIR/input"\necho "$@" > "$TMPDIR/args"\necho "$HOME|$LOPHN_HOME|$LOPHN_CORE_URL|$LOPHN_CREDENTIAL" > "$TMPDIR/env"\n${body}\n`,
  );
  await Deno.chmod(path, 0o700);
  return path;
}

async function withHost<T>(
  body: string,
  fn: (context: {
    dir: string;
    command: string;
    input: ScreenTestInput;
  }) => Promise<T>,
): Promise<T> {
  const dir = await Deno.makeTempDir({ prefix: "lophn-screen-host-test-" });
  try {
    const command = await fakeHost(dir, body);
    return await fn({ dir, command, input: inputFor(`${dir}/app.sock`) });
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("problems/tests#R7, R19: exit 0과 contract 안의 관측 한 줄은 관측이고 host는 --app-screen-test와 임시 환경으로 뜬다", async () => {
  await withHost(`echo '${OBSERVATION}' >&3`, async (context) => {
    const result = await runScreenHost({
      command: context.command,
      input: context.input,
      work_dir: context.dir,
    });
    assertEquals(result.kind, "observation");
    assertEquals(
      (await Deno.readTextFile(`${context.dir}/screen-tmp/args`)).trim(),
      "--app-screen-test",
    );
    const input = JSON.parse(
      await Deno.readTextFile(`${context.dir}/screen-tmp/input`),
    );
    assertEquals(input.app_socket_path, context.input.app_socket_path);
    // 실제 HOME·core 주소·credential은 child에 없다.
    const env = (await Deno.readTextFile(`${context.dir}/screen-tmp/env`))
      .trim();
    assertEquals(
      env,
      `${context.dir}/screen-home|${context.dir}/screen-lophn-home||`,
    );
  });
});

Deno.test("problems/tests#R7, R19: exit 2·3·4와 stdout의 pass 문자열은 판정 불가이고 pass가 아니다", async () => {
  for (const code of [2, 3, 4]) {
    await withHost(
      `echo '${OBSERVATION}' >&3\necho pass\nexit ${code}`,
      async (context) => {
        const result = await runScreenHost({
          command: context.command,
          input: context.input,
          work_dir: context.dir,
        });
        assertEquals(result.kind, "inconclusive");
      },
    );
  }
  await withHost("echo pass\nexit 0", async (context) => {
    const result = await runScreenHost({
      command: context.command,
      input: context.input,
      work_dir: context.dir,
    });
    assertEquals(result.kind, "inconclusive");
  });
});

Deno.test("problems/tests#R19: schema에 맞지 않거나 한 줄이 아니거나 frame 상한을 넘는 관측은 판정 불가다", async () => {
  const cases = [
    `echo '{"load":[]}' >&3`,
    `printf '%s\\n%s\\n' '${OBSERVATION}' '${OBSERVATION}' >&3`,
    `head -c ${SCREEN_OBSERVATION_MAX_BYTES + 10} /dev/zero | tr '\\0' 'a' >&3`,
  ];
  for (const body of cases) {
    await withHost(body, async (context) => {
      const result = await runScreenHost({
        command: context.command,
        input: context.input,
        work_dir: context.dir,
      });
      assertEquals(result.kind, "inconclusive");
    });
  }
});

Deno.test("problems/tests#R7: host 실행 파일을 띄울 수 없으면 unavailable이다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "lophn-screen-host-test-" });
  try {
    const result = await runScreenHost({
      command: `${dir}/missing-host`,
      input: inputFor(`${dir}/app.sock`),
      work_dir: dir,
    });
    assertEquals(result.kind, "unavailable");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("problems/tests#R7: test 앱 socket은 연결 증명(빈 Authorization) 없이 command 호출을 받고 다른 경로는 받지 않는다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "lophn-screen-host-test-" });
  const path = `${dir}/app.sock`;
  const calls: unknown[] = [];
  const socket = serveTestAppSocket({
    path,
    invoke(command, input) {
      calls.push({ command, input });
      return Promise.resolve({ ok: true as const, value: { pong: true } });
    },
  });
  try {
    const client = Deno.createHttpClient({
      proxy: { transport: "unix", path },
    });
    const response = await fetch("http://app/_lophn/commands/invoke", {
      method: "POST",
      headers: { authorization: "", "content-type": "application/json" },
      body: JSON.stringify({ command: "fixture.ping", input: { n: 1 } }),
      client,
    });
    assertEquals(response.status, 200);
    assertEquals(await response.json(), { result: { result: { pong: true } } });
    assertEquals(calls, [{ command: "fixture.ping", input: { n: 1 } }]);
    const other = await fetch("http://app/other", { client });
    assertEquals(other.status, 404);
    await other.body?.cancel();
    assertFalse(calls.length > 1);
    client.close();
  } finally {
    await socket.shutdown();
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("problems/tests#R7: 화면 폴더에 render 오류 event 글자가 있는 화면만 루트 오류 경계가 있다고 본다", async () => {
  const bundle = new URL("../../../../../fixtures/app-screens", import.meta.url)
    .pathname;
  const boundaries = await screenErrorBoundaries({
    bundle_screens_dir: bundle,
    screens: [
      { key: "clean", path: "clean/index.html" },
      { key: "plain", path: "plain/index.html" },
      { key: "missing", path: "missing/index.html" },
    ],
  });
  assertEquals([...boundaries], ["clean"]);
});

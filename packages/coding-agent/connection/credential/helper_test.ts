// production credential provider(helper loader)의 시험이다. helper는 temp dir의 sh script 대역이라
// 사람의 실제 keychain·data root·harness 설정은 열지 않는다.
import { assert, assertEquals, assertFalse } from "@std/assert";
import { CREDENTIAL_DELIVERY_FAILURES } from "../../../protocol/coding-agent/mod.ts";
import {
  createHelperCredentialProvider,
  processGenerationOf,
  startTicksOf,
} from "./helper.ts";

const CAC = "cac_01h455vb4pex5v6nkc6gd5fdw1";
const TOKEN = "helper-delivered-token-5e1f9d";

type Fake = { dir: string; helper: string; requests: string };

async function fake(body: string): Promise<Fake> {
  const dir = await Deno.makeTempDir({ prefix: "lophn-helper-" });
  const requests = `${dir}/requests.log`;
  const helper = `${dir}/lophn-credential`;
  await Deno.writeTextFile(
    helper,
    `#!/bin/sh\ncat >> "${requests}"\necho >> "${requests}"\n${body}\n`,
  );
  await Deno.chmod(helper, 0o755);
  return { dir, helper, requests };
}

Deno.test("coding-agent/connection#R17 coding-agent/mcp-server#R36: helper에 connection 참조 요청 하나를 stdin으로 보내 token을 한 번 받고 helper를 다시 부르지 않는다", async () => {
  const f = await fake(`printf '%s' '{"token":"${TOKEN}"}'`);
  try {
    const provider = createHelperCredentialProvider({
      helper: f.helper,
      generation: () => "4242.77",
    });
    const first = await provider(CAC);
    assert(first.ok);
    assertEquals(first.value.token, TOKEN);
    const second = await provider(CAC);
    assert(second.ok);
    // 요청은 한 번이고 purpose·loader identity·generation·connection만 담는다. token은 요청에 없다.
    const sent = (await Deno.readTextFile(f.requests)).trim().split("\n");
    assertEquals(sent.length, 1);
    assertEquals(JSON.parse(sent[0]), {
      connection: CAC,
      process_generation: "4242.77",
      loader_identity: f.helper,
      purpose: "mcp_cli_loader",
    });
    assertFalse(sent[0].includes(TOKEN));
  } finally {
    await Deno.remove(f.dir, { recursive: true });
  }
});

Deno.test("coding-agent/connection#R17 coding-agent/connection#R9: locked·no_secret_service·timeout·not_found는 서로 다른 이유의 실패이고 실패는 다시 시도하되 평문·user credential fallback이 없다", async () => {
  for (const reason of CREDENTIAL_DELIVERY_FAILURES) {
    if (reason === "timeout") continue;
    const f = await fake(`printf '%s' '{"reason":"${reason}"}'\nexit 1`);
    try {
      const provider = createHelperCredentialProvider({
        helper: f.helper,
        generation: () => "1",
        retry: { intervalMs: 1, boundMs: 0 },
      });
      const result = await provider(CAC);
      assert(!result.ok);
      assertEquals(result.error, reason);
      // 실패는 두지 않는다. 다시 부르면 helper를 다시 받는다(새 token 발급은 없다).
      assert(!(await provider(CAC)).ok);
      assertEquals(
        (await Deno.readTextFile(f.requests)).trim().split("\n").length,
        2,
      );
    } finally {
      await Deno.remove(f.dir, { recursive: true });
    }
  }
});

Deno.test("coding-agent/connection#R17 coding-agent/mcp-server#R36: helper가 없거나 이상한 출력이면 이유가 있는 unavailable이고 출력·경로는 오류에 없다", async () => {
  const missing = createHelperCredentialProvider({
    helper: "/nonexistent/lophn-credential",
    generation: () => "1",
  });
  const none = await missing(CAC);
  assert(!none.ok);
  assertEquals(none.error, "no_secret_service");

  const relative = createHelperCredentialProvider({
    helper: "lophn-credential",
    generation: () => "1",
  });
  const rel = await relative(CAC);
  assert(!rel.ok);
  assertEquals(rel.error, "no_secret_service");

  // 성공 종료인데 token 모양이 아니거나 token이 섞인 이상한 출력은 not_found다.
  const f = await fake(`printf '%s' 'not json ${TOKEN}'`);
  try {
    const garbled = await createHelperCredentialProvider({
      helper: f.helper,
      generation: () => "1",
      retry: { intervalMs: 1, boundMs: 0 },
    })(CAC);
    assert(!garbled.ok);
    assertEquals(garbled.error, "not_found");
    assertFalse(JSON.stringify(garbled).includes(TOKEN));
  } finally {
    await Deno.remove(f.dir, { recursive: true });
  }
  const g = await fake(`printf '%s' '{"token":"${TOKEN}","extra":1}'`);
  try {
    const extra = await createHelperCredentialProvider({
      helper: g.helper,
      generation: () => "1",
      retry: { intervalMs: 1, boundMs: 0 },
    })(CAC);
    assert(!extra.ok);
    assertFalse(JSON.stringify(extra).includes(TOKEN));
  } finally {
    await Deno.remove(g.dir, { recursive: true });
  }
});

Deno.test("coding-agent/connection#R17 coding-agent/mcp-server#R36: helper가 기한 안에 답하지 않으면 timeout이고 helper process를 남기지 않는다", async () => {
  const f = await fake(`sleep 3`);
  try {
    const provider = createHelperCredentialProvider({
      helper: f.helper,
      generation: () => "1",
      timeoutMs: 150,
    });
    const started = Date.now();
    const result = await provider(CAC);
    assert(!result.ok);
    assertEquals(result.error, "timeout");
    assert(Date.now() - started < 5_000);
  } finally {
    await Deno.remove(f.dir, { recursive: true });
  }
});

Deno.test("coding-agent/connection#R17: 같은 connection의 동시 요청은 helper를 한 번만 부른다", async () => {
  const f = await fake(`sleep 0.2\nprintf '%s' '{"token":"${TOKEN}"}'`);
  try {
    const provider = createHelperCredentialProvider({
      helper: f.helper,
      generation: () => "1",
    });
    const [a, b] = await Promise.all([provider(CAC), provider(CAC)]);
    assert(a.ok && b.ok);
    assertEquals(
      (await Deno.readTextFile(f.requests)).trim().split("\n").length,
      1,
    );
  } finally {
    await Deno.remove(f.dir, { recursive: true });
  }
});

Deno.test("coding-agent/connection#R17: process generation은 pid와 시작 tick으로 만들고 읽지 못하면 pid뿐이다", () => {
  const stat =
    "4242 (lophn mcp (x)) S 1 4242 4242 0 -1 4194560 100 0 0 0 1 0 0 0 20 0 1 0 987654 1000 100 18446744073709551615";
  assertEquals(startTicksOf(stat), "987654");
  assertEquals(processGenerationOf(4242, "987654"), "4242.987654");
  assertEquals(processGenerationOf(4242, undefined), "4242");
  assertEquals(startTicksOf("garbage"), undefined);
});

// 시계는 sleep만큼 가는 fake다. 실제 기다림 없이 한도를 본다.
function fakeClock() {
  let at = 0;
  return {
    now: () => at,
    sleep: (ms: number) => {
      at += ms;
      return Promise.resolve();
    },
  };
}

async function requestCount(f: Fake): Promise<number> {
  return (await Deno.readTextFile(f.requests)).trim().split("\n").length;
}

Deno.test("coding-agent/connection#R17 platform/identity#R15: 등록이 첫 요청 뒤에 와도 not_found를 한도 안에서 다시 물어 child가 token을 받는다", async () => {
  // 세 번째 요청부터 등록된 것처럼 token을 낸다(요청마다 기록 한 줄).
  const f = await fake(
    [
      'if [ "$(wc -l < "$(dirname "$0")/requests.log")" -ge 3 ]; then',
      `  printf '%s' '{"token":"${TOKEN}"}'`,
      "else",
      `  printf '%s' '{"reason":"not_found"}'; exit 1`,
      "fi",
    ].join("\n"),
  );
  try {
    const provider = createHelperCredentialProvider({
      helper: f.helper,
      generation: () => "7.7",
      clock: fakeClock(),
    });
    const got = await provider(CAC);
    assert(got.ok, got.ok ? "" : got.error);
    assertEquals(got.value.token, TOKEN);
    assertEquals(await requestCount(f), 3);
  } finally {
    await Deno.remove(f.dir, { recursive: true });
  }
});

Deno.test("coding-agent/connection#R17 platform/identity#R15: 등록이 끝내 오지 않으면 한도(100ms 간격 3초) 뒤에 not_found로 실패한다", async () => {
  const f = await fake(`printf '%s' '{"reason":"not_found"}'\nexit 1`);
  try {
    const provider = createHelperCredentialProvider({
      helper: f.helper,
      generation: () => "8.8",
      clock: fakeClock(),
    });
    const result = await provider(CAC);
    assertFalse(result.ok);
    assertEquals(result.error, "not_found");
    // 처음 한 번과 100ms 간격 30번이다.
    assertEquals(await requestCount(f), 31);
  } finally {
    await Deno.remove(f.dir, { recursive: true });
  }
});

Deno.test("coding-agent/connection#R17 platform/identity#R15: not_found 밖의 답(locked·no_secret_service)은 다시 묻지 않고 바로 실패한다", async () => {
  for (const reason of ["locked", "no_secret_service"]) {
    const f = await fake(`printf '%s' '{"reason":"${reason}"}'\nexit 1`);
    try {
      const result = await createHelperCredentialProvider({
        helper: f.helper,
        generation: () => "9.9",
        clock: fakeClock(),
      })(CAC);
      assertFalse(result.ok);
      assertEquals(result.error, reason);
      assertEquals(await requestCount(f), 1);
    } finally {
      await Deno.remove(f.dir, { recursive: true });
    }
  }
});

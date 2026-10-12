import { assert, assertEquals, assertFalse } from "@std/assert";
import { err, ok } from "../../base/mod.ts";
import {
  CREDENTIAL_DELIVERY_FAILURES,
  CREDENTIAL_DELIVERY_TIMEOUT_MS,
  CREDENTIAL_HELPER,
  credentialDeliveryRequestSchema,
} from "../../protocol/coding-agent/mod.ts";
import type { CodingCredentialAuthority } from "../identity/mod.ts";
import { serveCredentialSocket } from "./credential-channel.ts";
import {
  CREDENTIAL_FAILURE_REASONS,
  CREDENTIAL_HELPER_TIMEOUT_MS,
  credentialSocketPath,
  helperDataRoot,
} from "./credential-helper.ts";
import {
  CREDENTIAL_HELPER_COMPILE_FLAGS,
  credentialLoaderIdentity,
  linuxInstallLayout,
} from "./linux-install.ts";

const HELPER_ENTRY = new URL("./credential-helper-main.ts", import.meta.url)
  .pathname;
const CONNECTION = "cac_01arz3ndektsv4rrffq69g5fav";
const GENERATION = "gen-1";
const TOKEN = "t".repeat(43);

// 등록된 child 하나와 token 하나만 아는 authority다. 확인 규칙의 본체는 identity의 시험이 맡고
// 여기서는 통로가 요청을 그대로 건네고 확인한 응답만 낸다는 것을 본다.
function authority(
  options: { stall?: boolean } = {},
): Pick<CodingCredentialAuthority, "deliver"> {
  return {
    async deliver(request, channel) {
      if (options.stall) await new Promise(() => {});
      const parsed = credentialDeliveryRequestSchema.safeParse(request);
      if (
        !parsed.success || parsed.data.connection !== CONNECTION ||
        parsed.data.process_generation !== GENERATION ||
        parsed.data.loader_identity !== credentialLoaderIdentity()
      ) {
        return err("not_found");
      }
      const sent = await channel.send(
        {
          process_generation: parsed.data.process_generation,
          loader_identity: parsed.data.loader_identity,
        },
        new TextEncoder().encode(TOKEN),
      );
      return sent.ok ? ok(undefined) : err("no_secret_service");
    },
  };
}

const request = (override: Record<string, string> = {}) =>
  JSON.stringify({
    connection: CONNECTION,
    process_generation: GENERATION,
    loader_identity: credentialLoaderIdentity(),
    purpose: "mcp_cli_loader",
    ...override,
  });

async function withHome<T>(
  body: (home: string) => Promise<T>,
): Promise<T> {
  const home = await Deno.makeTempDir({ prefix: "lophn-cred-" });
  await Deno.mkdir(`${home}/run`, { mode: 0o700 });
  try {
    return await body(home);
  } finally {
    await Deno.remove(home, { recursive: true });
  }
}

// 설치 묶음과 같은 방식으로 compile한 binary다. 권한은 helper가 쓰는 것뿐이다.
let helperBinary: string | undefined;
async function helper(): Promise<string> {
  if (helperBinary !== undefined) return helperBinary;
  const dir = await Deno.makeTempDir({ prefix: "lophn-helper-bin-" });
  const out = `${dir}/lophn-credential`;
  const compiled = await new Deno.Command(Deno.execPath(), {
    args: [
      "compile",
      ...CREDENTIAL_HELPER_COMPILE_FLAGS,
      "-o",
      out,
      HELPER_ENTRY,
    ],
    stdout: "null",
    stderr: "piped",
  }).output();
  assert(compiled.success, new TextDecoder().decode(compiled.stderr));
  helperBinary = out;
  return out;
}

async function runHelper(home: string, stdin: string) {
  const child = new Deno.Command(await helper(), {
    env: { LOPHN_HOME: home, HOME: home },
    clearEnv: true,
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const writer = child.stdin.getWriter();
  await writer.write(new TextEncoder().encode(stdin));
  await writer.close();
  const output = await child.output();
  return {
    code: output.code,
    stdout: new TextDecoder().decode(output.stdout),
    stderr: new TextDecoder().decode(output.stderr),
  };
}

Deno.test("platform/identity#R15: helper는 core socket에서 확인된 token을 stdout으로만 낸다", async () => {
  await withHome(async (home) => {
    const served = await serveCredentialSocket({
      dataRoot: home,
      authority: authority(),
    });
    assert(served.ok);
    try {
      const done = await runHelper(home, request());
      assertEquals(done.code, 0);
      assertEquals(JSON.parse(done.stdout), { token: TOKEN });
      assertEquals(done.stderr, "");
    } finally {
      await served.value.close();
    }
  });
});

Deno.test("platform/identity#R15: 등록되지 않은 child·다른 loader·잘못된 요청은 모두 같은 not_found다", async () => {
  await withHome(async (home) => {
    const served = await serveCredentialSocket({
      dataRoot: home,
      authority: authority(),
    });
    assert(served.ok);
    try {
      for (
        const body of [
          request({ process_generation: "other" }),
          request({ loader_identity: "/tmp/other" }),
          request({ connection: "cac_01arz3ndektsv4rrffq69g5fax" }),
          "not json",
        ]
      ) {
        const done = await runHelper(home, body);
        assertEquals(done.code, 1);
        assertEquals(JSON.parse(done.stdout), { reason: "not_found" });
        assertFalse(done.stdout.includes(TOKEN));
      }
    } finally {
      await served.value.close();
    }
  });
});

Deno.test("platform/identity#R15: core 없이 helper를 부르면 no_secret_service이고 평문 fallback은 없다", async () => {
  await withHome(async (home) => {
    const done = await runHelper(home, request());
    assertEquals(done.code, 1);
    assertEquals(JSON.parse(done.stdout), { reason: "no_secret_service" });
    // 어떤 token 파일도 만들지 않는다.
    const names = [];
    for await (const entry of Deno.readDir(`${home}/run`)) {
      names.push(entry.name);
    }
    assertEquals(names, []);
  });
});

Deno.test("platform/identity#R15: socket은 소유자 전용이고 이전 실행의 socket만 대체한다", async () => {
  await withHome(async (home) => {
    const first = await serveCredentialSocket({
      dataRoot: home,
      authority: authority(),
    });
    assert(first.ok);
    const stat = await Deno.stat(first.value.path);
    assertEquals(stat.mode! & 0o777, 0o600);
    await first.value.close();
    // 정상 종료는 socket을 지운다.
    assertFalse(await exists(first.value.path));

    // 죽은 core가 남긴 socket 파일은 새 core가 대체한다.
    const stale = Deno.listen({
      transport: "unix",
      path: credentialSocketPath(home),
    });
    stale.close();
    const second = await serveCredentialSocket({
      dataRoot: home,
      authority: authority(),
    });
    assert(second.ok);
    await second.value.close();

    // socket이 아닌 파일이 있는 자리는 지우지 않고 열지 않는다.
    await Deno.writeTextFile(credentialSocketPath(home), "keep");
    const refused = await serveCredentialSocket({
      dataRoot: home,
      authority: authority(),
    });
    assertFalse(refused.ok);
    assertEquals(await Deno.readTextFile(credentialSocketPath(home)), "keep");
  });
});

Deno.test("platform/identity#R15: 확인이 5초 안에 끝나지 않으면 timeout이다", async () => {
  await withHome(async (home) => {
    const served = await serveCredentialSocket({
      dataRoot: home,
      authority: authority({ stall: true }),
      timeoutMs: 100,
    });
    assert(served.ok);
    try {
      const done = await runHelper(home, request());
      assertEquals(done.code, 1);
      assertEquals(JSON.parse(done.stdout), { reason: "timeout" });
    } finally {
      await served.value.close();
    }
  });
});

Deno.test("platform/install-and-update#R6: helper 상수는 계약과 같고 데이터 root는 core와 같은 근원이다", () => {
  assertEquals(CREDENTIAL_HELPER, "lophn-credential");
  assertEquals(
    [...CREDENTIAL_FAILURE_REASONS],
    [...CREDENTIAL_DELIVERY_FAILURES],
  );
  assertEquals(CREDENTIAL_HELPER_TIMEOUT_MS, CREDENTIAL_DELIVERY_TIMEOUT_MS);
  assertEquals(
    helperDataRoot({ LOPHN_HOME: "/data", HOME: "/home/a" }),
    "/data",
  );
  assertEquals(helperDataRoot({ HOME: "/home/a" }), "/home/a/.lophn");
  assertEquals(helperDataRoot({}), undefined);
  // loader identity는 설치 묶음의 고정 절대 경로고 binary 이름이 계약 이름이다.
  const layout = linuxInstallLayout();
  assertEquals(layout.credentialHelper, `/opt/lophn/${CREDENTIAL_HELPER}`);
  assertEquals(credentialLoaderIdentity(layout), layout.credentialHelper);
});

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.lstat(path);
    return true;
  } catch {
    return false;
  }
}

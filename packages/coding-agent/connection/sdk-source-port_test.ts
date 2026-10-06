// CLI SdkSourcePort 시험이다(mcp#R23, cli#R30, T36). temp 폴더의 앱 source에서 deno.json 한 파일만
// 읽고 쓰며 deno.lock 재생성은 주입한 Deno 실행으로만 한다. 사람의 실제 앱 source는 열지 않는다.
import { assert, assertEquals } from "@std/assert";
import { createSdkSourcePort } from "./sdk-source.ts";
import { runSdkOp } from "./sdk-ops.ts";
import { scriptedFlow } from "./testing/mod.ts";

const APP = "app_01arz3ndektsv4rrffq69g5fav";

function flowFor(sourcePath: string) {
  return scriptedFlow({
    "packages.versions": {
      name: "@lophn/ui-table",
      versions: [{
        version: "1.2.0",
        bundle_hash: "a".repeat(64),
        guide_hash: "b".repeat(64),
      }],
      as_of_seq: 1,
      next_cursor: null,
    },
    "packages.guide": {
      name: "@lophn/ui-table",
      version: "1.2.0",
      guide_hash: "b".repeat(64),
      as_of_seq: 1,
      next_cursor: null,
    },
    "app.get": {
      app: { id: APP, slug: "notes", source_path: sourcePath, revision: "1" },
    },
  });
}

const INPUT = {
  op: "add",
  name: "@lophn/ui-table",
  version: "1.2.0",
  apply: true,
  app: APP,
};

Deno.test("coding-agent/mcp-server#R23 coding-agent/cli#R30: sdk add --apply는 앱 source의 deno.json만 고치고 설치 Deno로 lock을 다시 만든다", async () => {
  const source = await Deno.makeTempDir({ prefix: "lophn-sdk-src-" });
  try {
    await Deno.writeTextFile(
      `${source}/deno.json`,
      `${
        JSON.stringify({ imports: { "@std/assert": "jsr:@std/assert@1" } })
      }\n`,
    );
    await Deno.writeTextFile(`${source}/main.ts`, "export {};\n");
    const runs: { executable: string; args: readonly string[]; cwd: string }[] =
      [];
    const port = createSdkSourcePort({
      denoExecutable: "/opt/lophn/deno",
      run: (executable, args, cwd) => {
        runs.push({ executable, args, cwd });
        return Promise.resolve({ code: 0 });
      },
    });
    const result = await runSdkOp(INPUT, {
      client: flowFor(source).client,
      source: port,
      surface: "cli",
    });
    assertEquals(result.isError, undefined);
    const apply = (result.data as { apply: { outcome: string; lock: string } })
      .apply;
    assertEquals(apply.outcome, "changed");
    assertEquals(apply.lock, "refreshed");
    assertEquals(runs, [{
      executable: "/opt/lophn/deno",
      args: ["install", "--cached-only"],
      cwd: source,
    }]);
    const written = JSON.parse(await Deno.readTextFile(`${source}/deno.json`));
    assertEquals(written.imports, {
      "@std/assert": "jsr:@std/assert@1",
      "lophn-sdk:@lophn/ui-table@1.2.0": "./sdk/@lophn/ui-table/1.2.0/",
    });
    // 다른 source 파일은 그대로다.
    assertEquals(await Deno.readTextFile(`${source}/main.ts`), "export {};\n");
  } finally {
    await Deno.remove(source, { recursive: true });
  }
});

Deno.test("coding-agent/mcp-server#R23: lock 재생성 실패는 성공으로 꾸미지 않고 failed로 남으며 deno.json 변경은 그대로 보고한다", async () => {
  const source = await Deno.makeTempDir({ prefix: "lophn-sdk-src-" });
  try {
    await Deno.writeTextFile(`${source}/deno.json`, "{}\n");
    const result = await runSdkOp(INPUT, {
      client: flowFor(source).client,
      source: createSdkSourcePort({
        denoExecutable: "/opt/lophn/deno",
        run: () => Promise.resolve({ code: 1 }),
      }),
      surface: "cli",
    });
    const apply = (result.data as {
      apply: { outcome: string; lock: string; lock_error?: string };
    }).apply;
    assertEquals(apply.outcome, "changed");
    assertEquals(apply.lock, "failed");
    assert(apply.lock_error !== undefined);
  } finally {
    await Deno.remove(source, { recursive: true });
  }
});

Deno.test("coding-agent/mcp-server#R23: 이 port는 deno.json 밖 파일을 읽지도 쓰지도 않고 없는 deno.json은 없는 파일이다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "lophn-sdk-src-" });
  try {
    const port = createSdkSourcePort({ denoExecutable: "/opt/lophn/deno" });
    await Deno.writeTextFile(`${dir}/secret.txt`, "x");
    const read = await port.readText(`${dir}/secret.txt`);
    assert(!read.ok);
    assertEquals(read.error.code, "invalid_input");
    const wrote = await port.writeText(`${dir}/other.json`, "{}");
    assert(!wrote.ok);
    assertEquals(
      await Deno.readTextFile(`${dir}/secret.txt`),
      "x",
    );
    // 없는 deno.json은 없는 파일이다(ok(undefined)).
    const absent = await port.readText(`${dir}/deno.json`);
    assert(absent.ok);
    assertEquals(absent.value, undefined);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

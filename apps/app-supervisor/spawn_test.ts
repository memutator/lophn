import { assert, assertEquals } from "@std/assert";
import type { FlagSet } from "../../packages/core/apps/permissions/mod.ts";
import { spawnApp } from "./spawn.ts";

const deno = Deno.execPath();

Deno.test("apps/runtime#R4: 앱 코드의 오류는 supervisor를 끝내지 않는다", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      `${dir}/app.ts`,
      "throw new Error('app boom');",
    );
    const flags: FlagSet = { args: ["--quiet"], limits: [] };
    const child = await spawnApp({
      deno,
      entry: `${dir}/app.ts`,
      flags,
      importMap: `${dir}/import-map.json`,
      environment: {
        home: dir,
        denoDir: `${dir}/deno`,
        xdgCacheHome: `${dir}/cache`,
        path: "/usr/bin",
      },
      startLine: JSON.stringify({ app: "app" }),
    });
    await Deno.writeTextFile(
      `${dir}/import-map.json`,
      JSON.stringify({ imports: {} }),
    );
    const code = await child.exited;
    // 앱이 죽어도 이 테스트(supervisor 자리)는 계속 돈다.
    assert(code !== 0);
    assertEquals(await child.terminate(), true);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("apps/runtime#R7: 자식 argv에 token·secret이 없고 시작 JSON은 stdin으로만 간다", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      `${dir}/import-map.json`,
      JSON.stringify({ imports: {} }),
    );
    await Deno.writeTextFile(
      `${dir}/app.ts`,
      [
        "const line = new TextDecoder().decode(await Deno.stdin.readable.getReader().read().then((r) => r.value));",
        `await Deno.writeTextFile(${
          JSON.stringify(`${dir}/seen.txt`)
        }, JSON.stringify({ args: Deno.args, line }));`,
      ].join("\n"),
    );
    const child = await spawnApp({
      deno,
      entry: `${dir}/app.ts`,
      flags: {
        args: [`--allow-read=${dir}`, `--allow-write=${dir}`],
        limits: [],
      },
      importMap: `${dir}/import-map.json`,
      environment: {
        home: dir,
        denoDir: `${dir}/deno`,
        xdgCacheHome: `${dir}/cache`,
        path: "/usr/bin",
      },
      startLine: JSON.stringify({ broker_credential: "broker-only" }),
    });
    await child.exited;
    await child.terminate();
    const seen = JSON.parse(await Deno.readTextFile(`${dir}/seen.txt`)) as {
      args: string[];
      line: string;
    };
    assertEquals(seen.args.includes("broker-only"), false);
    assert(seen.line.includes("broker-only"));
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("apps/runtime#R23: 원격 import는 --cached-only --no-remote로 시작에 실패한다", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      `${dir}/import-map.json`,
      JSON.stringify({ imports: {} }),
    );
    await Deno.writeTextFile(
      `${dir}/app.ts`,
      'import "https://example.com/remote.ts";',
    );
    const child = await spawnApp({
      deno,
      entry: `${dir}/app.ts`,
      flags: { args: ["--cached-only", "--no-remote", "--quiet"], limits: [] },
      importMap: `${dir}/import-map.json`,
      environment: {
        home: dir,
        denoDir: `${dir}/deno`,
        xdgCacheHome: `${dir}/cache`,
        path: "/usr/bin",
      },
      startLine: "{}",
    });
    const code = await child.exited;
    assert(code !== 0);
    await child.terminate();
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("apps/runtime#R4: 앱 프로세스에 플랫폼 DB 접근을 주지 않는다", async () => {
  const dir = await Deno.makeTempDir();
  const platform = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(`${platform}/lophn.db`, "secret-ledger");
    await Deno.writeTextFile(
      `${dir}/import-map.json`,
      JSON.stringify({ imports: {} }),
    );
    await Deno.writeTextFile(
      `${dir}/app.ts`,
      `try { await Deno.readTextFile(${
        JSON.stringify(`${platform}/lophn.db`)
      }); Deno.exit(0); } catch { Deno.exit(2); }`,
    );
    const child = await spawnApp({
      deno,
      entry: `${dir}/app.ts`,
      flags: {
        args: [`--allow-read=${dir}`],
        limits: [],
      },
      importMap: `${dir}/import-map.json`,
      environment: {
        home: dir,
        denoDir: `${dir}/deno`,
        xdgCacheHome: `${dir}/cache`,
        path: "/usr/bin",
      },
      startLine: "{}",
    });
    assertEquals(await child.exited, 2);
    await child.terminate();
  } finally {
    await Deno.remove(dir, { recursive: true });
    await Deno.remove(platform, { recursive: true });
  }
});

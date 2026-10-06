import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  CapabilityError,
  checkDeclaration,
  readTextFile,
  watch,
  writeTextFile,
} from "./mod.ts";

const MOD = new URL("./mod.ts", import.meta.url).href;

// 실제 Deno flag가 막는 접근을 보려고 자식 프로세스를 허락 범위만 주고 띄운다.
async function probe(
  flags: string[],
  body: string,
): Promise<Record<string, unknown>> {
  const dir = await Deno.makeTempDir({ prefix: "cap-fs-probe-" });
  try {
    const script = `${dir}/probe.ts`;
    await Deno.writeTextFile(
      script,
      `import * as fs from ${JSON.stringify(MOD)};
const out: Record<string, unknown> = {};
const hit = async (name: string, work: () => Promise<unknown>) => {
  try { out[name] = { ok: (await work()) ?? null }; }
  catch (error) {
    const e = error as { code?: string; permission?: string; scope?: unknown; message?: string };
    out[name] = { code: e.code, permission: e.permission, scope: e.scope, message: e.message };
  }
};
${body}
console.log(JSON.stringify(out));`,
    );
    const output = await new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--no-prompt",
        "--no-config",
        "--no-lock",
        "--quiet",
        ...flags,
        script,
      ],
      stdout: "piped",
      stderr: "piped",
    }).output();
    const text = new TextDecoder().decode(output.stdout);
    assert(output.success, new TextDecoder().decode(output.stderr));
    return JSON.parse(text);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("apps/sdk#R24: cap-fs reads and writes inside the allowed paths", async () => {
  const dir = await Deno.makeTempDir({ prefix: "cap-fs-" });
  try {
    await writeTextFile(`${dir}/note.txt`, "first");
    await writeTextFile(`${dir}/note.txt`, "-second", { append: true });
    assertEquals(await readTextFile(`${dir}/note.txt`), "first-second");
    await assertRejects(
      () => writeTextFile(`${dir}/note.txt`, "x", { createNew: true }),
      CapabilityError,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("apps/sdk#R24: cap-fs watch reports a change in the watched directory and closes", async () => {
  const dir = await Deno.makeTempDir({ prefix: "cap-fs-watch-" });
  try {
    const seen: string[] = [];
    const gotOne = Promise.withResolvers<void>();
    const watcher = watch(dir, (event) => {
      seen.push(event.kind);
      gotOne.resolve();
    });
    await writeTextFile(`${dir}/a.txt`, "a");
    await gotOne.promise;
    assert(seen.length > 0);
    watcher.close();
    await watcher.done;
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("apps/sdk#R23: cap-fs refusals name the permission and the exact path", async () => {
  const allowed = await Deno.makeTempDir({ prefix: "cap-fs-allowed-" });
  const outside = await Deno.makeTempDir({ prefix: "cap-fs-outside-" });
  try {
    await Deno.writeTextFile(`${outside}/secret.txt`, "hidden");
    const result = await probe(
      [`--allow-read=${allowed}`, `--allow-write=${allowed}`],
      `await hit("readOut", () => fs.readTextFile(${
        JSON.stringify(`${outside}/secret.txt`)
      }));
await hit("writeOut", () => fs.writeTextFile(${
        JSON.stringify(`${outside}/new.txt`)
      }, "x"));
await hit("writeIn", () => fs.writeTextFile(${
        JSON.stringify(`${allowed}/in.txt`)
      }, "ok"));
await hit("readIn", () => fs.readTextFile(${
        JSON.stringify(`${allowed}/in.txt`)
      }));
await hit("watchOut", () => { fs.watch(${
        JSON.stringify(outside)
      }, () => {}); return Promise.resolve(true); });
await hit("missing", () => fs.readTextFile(${
        JSON.stringify(`${allowed}/missing.txt`)
      }));`,
    );
    assertEquals(result.readOut, {
      code: "forbidden",
      permission: "fs.read",
      scope: { path: `${outside}/secret.txt`, recursive: false },
      message: (result.readOut as { message: string }).message,
    });
    assert(
      (result.readOut as { message: string }).message.includes("fs.read") &&
        (result.readOut as { message: string }).message.includes(
          `${outside}/secret.txt`,
        ),
    );
    assertEquals(
      (result.writeOut as { permission: string }).permission,
      "fs.write",
    );
    assertEquals(result.writeIn, { ok: null });
    assertEquals(result.readIn, { ok: "ok" });
    assertEquals(
      (result.watchOut as { permission: string; scope: unknown }).scope,
      { path: outside, recursive: false },
    );
    assertEquals((result.missing as { code: string }).code, "not_found");
    // 막힌 파일 내용은 오류 안내에도 없다.
    assert(!JSON.stringify(result).includes("hidden"));
  } finally {
    await Deno.remove(allowed, { recursive: true });
    await Deno.remove(outside, { recursive: true });
  }
});

Deno.test("apps/sdk#R22: fs.write alone does not allow reading", async () => {
  const dir = await Deno.makeTempDir({ prefix: "cap-fs-write-only-" });
  try {
    const result = await probe(
      [`--allow-write=${dir}`],
      `await hit("write", () => fs.writeTextFile(${
        JSON.stringify(`${dir}/w.txt`)
      }, "x"));
await hit("read", () => fs.readTextFile(${JSON.stringify(`${dir}/w.txt`)}));`,
    );
    assertEquals(result.write, { ok: null });
    assertEquals((result.read as { permission: string }).permission, "fs.read");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("apps/sdk#R22: a declaration that uses cap-fs without fs permission is rejected", () => {
  const using = [{ name: "@lophn/cap-fs" }];
  const refused = checkDeclaration({
    sdk_dependencies: using,
    permissions: [],
  });
  assert(!refused.ok);
  assertEquals(refused.error.permissions, ["fs.read", "fs.write"]);
  assert(refused.error.message.includes("fs.read or fs.write"));
  assertEquals(
    checkDeclaration({
      sdk_dependencies: using,
      permissions: [{ kind: "net.fetch" }],
    }).ok,
    false,
  );
  assert(
    checkDeclaration({
      sdk_dependencies: using,
      permissions: [{ kind: "fs.read" }],
    }).ok,
  );
  // 쓰지 않는 앱은 선언에 fs permission이 없어도 된다. import는 grant를 주지도 요구하지도 않는다.
  assert(checkDeclaration({ sdk_dependencies: [], permissions: [] }).ok);
});

import { assertEquals, assertNotEquals } from "@std/assert";
import { ok } from "../../../base/mod.ts";
import { assembleException } from "./work.ts";

const APP = `app_${"0".repeat(26)}`;
const PROJECT = `prj_${"0".repeat(26)}`;
const HASH = "a".repeat(64);

function screenMap(source: string, mappings: string): string {
  return JSON.stringify({
    version: 3,
    sources: [source],
    sourcesContent: ["x"],
    mappings,
  });
}

// 화면이 둘인 앱에서 stack이 가리킨 화면의 map으로 그 화면의 source 위치가 풀리고
// 다른 화면 source로 풀리지 않는다. stack file은 bundle 사본 안 화면 JS다.
Deno.test("assembleException: stack이 가리킨 화면의 map으로 source 위치를 푼다", async () => {
  const dataRoot = await Deno.makeTempDir();
  try {
    const copy = `${dataRoot}/projects/${PROJECT}/app/bundles/${HASH}`;
    await Deno.mkdir(`${copy}/screens/a`, { recursive: true });
    await Deno.mkdir(`${copy}/screens/b`, { recursive: true });
    await Deno.writeTextFile(
      `${copy}/manifest.json`,
      JSON.stringify({ entrypoint: "x", files: [] }),
    );
    await Deno.writeTextFile(
      `${copy}/screens/a/main.js.map`,
      screenMap("src/a.tsx", "AAGE"),
    );
    await Deno.writeTextFile(
      `${copy}/screens/b/main.js.map`,
      screenMap("src/b.tsx", "AASA"),
    );
    const result = await assembleException(
      {
        report_id: "rpt_0",
        observed_at: "2026-10-17T00:00:00.000Z",
        observation: "uncaught_exception",
        error: {
          name: "Error",
          message: "boom",
          stack:
            `Error: boom\n    at render (file://${copy}/screens/b/main.js:1:50)`,
        },
        invocation: null,
      },
      { app: APP, bundle_hash: HASH },
      {
        blobPrepare: {
          prepare: (input) =>
            Promise.resolve(ok({
              preparation: "p",
              principal: input.principal,
              purpose: input.purpose,
              hash: "b".repeat(64),
              size_bytes: 1,
            })),
        },
        folder: { bundleCopy: () => Promise.resolve(copy) },
        nowAt: "2026-10-17T00:00:00.000Z",
        principal: "machine:test",
      },
    );
    assertEquals(result.ok, true);
    if (!result.ok) return;
    assertEquals(
      result.value.snapshot.error?.frames.map((frame) => [
        frame.path,
        frame.line,
        frame.column,
      ]),
      [["src/b.tsx", 10, 1]],
    );
  } finally {
    await Deno.remove(dataRoot, { recursive: true });
  }
});

// stack 없는 관측은 report id가 아니라 이유로 묶는다. 메시지(exit code)나 release(bundle hash)가
// 다르면 다른 문제다.
Deno.test("assembleException: stack 없는 같은 이유의 관측은 같은 group key다", async () => {
  const assemble = async (
    reportId: string,
    message: string,
    bundleHash: string,
  ) => {
    const result = await assembleException(
      {
        report_id: reportId,
        observed_at: "2026-10-17T00:00:00.000Z",
        observation: "process_exit",
        error: { name: "unexpected_exit", message, stack: null },
        invocation: null,
      },
      { app: APP, bundle_hash: bundleHash },
      {
        blobPrepare: {
          prepare: () => Promise.reject(new Error("no blob expected")),
        },
        folder: { bundleCopy: null },
        nowAt: "2026-10-17T00:00:00.000Z",
        principal: "machine:test",
      },
    );
    if (!result.ok) throw new Error(result.error.message);
    return result.value.group_key;
  };
  const base = await assemble("rpt_1", "exited with code 1", HASH);
  assertEquals(await assemble("rpt_2", "exited with code 1", HASH), base);
  assertNotEquals(await assemble("rpt_3", "exited with code 2", HASH), base);
  assertNotEquals(
    await assemble("rpt_4", "exited with code 1", "b".repeat(64)),
    base,
  );
});

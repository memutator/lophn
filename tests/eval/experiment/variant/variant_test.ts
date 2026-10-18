import { assertEquals } from "@std/assert";
import { resolveVariant, type VariantIo } from "./mod.ts";

// run은 호출만 기록하고 성공한다. texts를 읽는 deno eval에는 빈 JSON을 돌려준다.
function fakeIo(files: string[]) {
  const runs: string[][] = [];
  const io: VariantIo = {
    realPath: (path) => Promise.resolve(path),
    gitToplevel: (path) =>
      Promise.resolve(path.endsWith("/plain") ? null : path),
    exists: (path) => Promise.resolve(files.includes(path)),
    nonEmpty: () => Promise.resolve(false),
    run: (cmd) => {
      runs.push(cmd);
      return Promise.resolve({
        code: 0,
        stdout: '{"role_prompts":{},"guides":{}}',
        stderr: "",
      });
    },
    symlink: () => Promise.resolve(),
    mkdir: () => Promise.resolve(),
  };
  return { io, runs };
}

const CURRENT = "/repo/main";
const ENTRY = "packages/core/main/daemon/main.ts";

Deno.test("다른 checkout을 줘도 registry와 checks, grader의 root는 지금 checkout이고 component·core·source를 재는 root만 variant다", async () => {
  const { io } = fakeIo([`/repo/wt/${ENTRY}`]);
  const r = await resolveVariant(
    { checkout: "/repo/wt", current: CURRENT },
    io,
  );
  if (!r.ok) throw new Error(r.error.message);
  const v = r.value;
  assertEquals(v.isCurrent, false);
  assertEquals(v.versionDeps.root, "/repo/wt");
  assertEquals(v.versionDeps.registryDir, `${CURRENT}/tests/eval/registry`);
  assertEquals(v.versionDeps.checksRoot, CURRENT);
  assertEquals(v.graderDeps, {
    root: CURRENT,
    registryDir: `${CURRENT}/tests/eval/registry`,
  });
});

Deno.test("git 최상위가 아닌 경로와 core 입구가 없는 경로는 prepare 전에 거절하고 지금 checkout은 prepare 없이 돌려준다", async () => {
  const { io, runs } = fakeIo([]);
  const code = async (checkout?: string) => {
    const r = await resolveVariant({ checkout, current: CURRENT }, io);
    return r.ok ? "ok" : r.error.code;
  };
  assertEquals(await code("/repo/plain"), "invalid_input");
  assertEquals(await code("/repo/wt"), "invalid_input");
  assertEquals(await code(CURRENT), "ok");
  assertEquals(await code(), "ok");
  assertEquals(runs, []);
});

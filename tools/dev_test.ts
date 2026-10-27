import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { devHomeOf, planCore, planRendererBuild } from "./dev.ts";

// dev가 사람의 진짜 data root를 열면 개발 중의 core가 사람의 앱과 대화를 고친다.
test("dev는 남긴 eval world를 열되 사람의 ~/.lophn과 그 아래는 열지 않는다", () => {
  const env = { HOME: "/home/me" };
  assert.deepStrictEqual(devHomeOf("/repo", env), {
    ok: true,
    path: "/repo/.dev-data",
  });
  assert.deepStrictEqual(
    devHomeOf("/repo", { ...env, LOPHN_DEV_HOME: "/tmp/lophn-eval/run/home" }),
    { ok: true, path: "/tmp/lophn-eval/run/home" },
  );
  for (const path of [
    "/home/me/.lophn",
    "/home/me/.lophn/",
    "/home/me/.lophn/x",
  ]) {
    assert.deepStrictEqual(
      devHomeOf("/repo", { ...env, LOPHN_DEV_HOME: path }).ok,
      false,
    );
  }
  assert.deepStrictEqual(
    devHomeOf("/repo", { ...env, LOPHN_DEV_HOME: "tmp/x" }).ok,
    false,
  );
});

// core는 Temporal이 있는 Electron의 Node로 뜨고, renderer build는 esbuild라 node로 바로 돈다.
test("dev가 띄우는 core와 renderer build의 argv·env", () => {
  const electron = createRequire(import.meta.url)("electron") as string;
  const plan = planCore("/repo", {
    dataRoot: "/repo/.dev-data",
    port: 0,
    env: { PATH: "/bin" },
  });
  assert.deepStrictEqual(plan.command, electron);
  assert.deepStrictEqual(plan.args, [
    "/repo/packages/core/main/daemon/main.ts",
    "--port=0",
  ]);
  assert.deepStrictEqual(plan.env, {
    PATH: "/bin",
    ELECTRON_RUN_AS_NODE: "1",
    LOPHN_HOME: "/repo/.dev-data",
  });
  assert.deepStrictEqual(planRendererBuild("/repo").command, "node");
  assert.deepStrictEqual(planRendererBuild("/repo").args, [
    "/repo/packages/shell/renderer/build.ts",
  ]);
});

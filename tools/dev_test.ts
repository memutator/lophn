import assert from "node:assert/strict";
import { test } from "node:test";
import { devHomeOf } from "./dev.ts";

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
  for (
    const path of ["/home/me/.lophn", "/home/me/.lophn/", "/home/me/.lophn/x"]
  ) {
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

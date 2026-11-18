import assert from "node:assert/strict";
import { test } from "node:test";
import { relaunchOf } from "./relaunch.ts";

// 누른 시작의 LOPHN_HOME이나 값이 떨어진 `--home`을 따르면 다시 띄운 desktop 앱이 다른 data root(사람의 ~/.lophn 포함)를 연다.
test("다시 띄우기는 늘 page host의 data root를 싣고 누른 시작의 LOPHN_HOME은 싣지 않는다", () => {
  const clicked = {
    DISPLAY: ":0",
    LOPHN_HOME: "/home/person/.lophn",
    OPENAI_API_KEY: "sk-secret",
  };
  const dev = relaunchOf({
    dataRoot: "/data/h",
    entry: "/repo/packages/shell/main/dist/main.cjs",
    own: { ELECTRON_NO_SANDBOX: "1" },
    clicked,
  });
  assert.deepEqual(dev, {
    args: [
      "--no-sandbox",
      "/repo/packages/shell/main/dist/main.cjs",
      "--home",
      "/data/h",
    ],
    env: { LOPHN_HOME: "/data/h", DISPLAY: ":0" },
  });

  const packaged = relaunchOf({
    dataRoot: "/data/h",
    entry: undefined,
    own: { ELECTRON_NO_SANDBOX: "1" },
    clicked,
  });
  assert.deepEqual(packaged?.args, ["--home", "/data/h"]);
  assert.equal(packaged?.env.LOPHN_HOME, "/data/h");

  // display 없는 시작으로는 desktop 앱이 서지 못한다. page host가 남는다.
  assert.equal(
    relaunchOf({
      dataRoot: "/data/h",
      entry: undefined,
      own: {},
      clicked: { LOPHN_HOME: "/elsewhere" },
    }),
    undefined,
  );
});

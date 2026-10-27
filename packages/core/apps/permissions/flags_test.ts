import assert from "node:assert/strict";
import { test } from "node:test";

import { appFlags } from "./flags.ts";

test("앱 process는 자기 DB 파일 밖에 쓰지 못한다", () => {
  const flags = appFlags(
    [],
    { bundle: "/b", data: "/d/app" },
    { ports: [] },
    [],
  );
  assert.ok(flags.ok);
  const write = flags.value.args.filter((arg) =>
    arg.startsWith("--allow-write="),
  );
  assert.deepStrictEqual(write, [
    "--allow-write=/d/app/app.sqlite,/d/app/app.sqlite-journal,/d/app/app.sqlite-shm,/d/app/app.sqlite-wal",
  ]);
});

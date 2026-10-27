import assert from "node:assert/strict";
import { test } from "node:test";

import type { VersionRef } from "../types.ts";
import { checkChange } from "./change.ts";

const ref = (name: string, n: number, kind = "instruction"): VersionRef => ({
  kind: kind as VersionRef["kind"],
  name,
  n,
});
const change = { from: ref("lophn", 3), to: ref("lophn", 4) };

test("checkChange: spec의 from이 안 바뀌었으면 막고, to의 n이나 다른 변경은 알리기만 한다", () => {
  const wrong = checkChange(change, [{
    from: ref("guide", 1),
    to: ref("guide", 2),
  }]);
  assert.ok(!wrong.ok);
  assert.ok(!checkChange(change, []).ok);

  const exact = checkChange(change, [change]);
  assert.deepStrictEqual(exact, { ok: true, warnings: [], mixed: [] });

  const guess = checkChange(change, [{
    from: ref("lophn", 3),
    to: ref("lophn", 5),
  }]);
  assert.ok(
    guess.ok && guess.warnings.length === 1 && guess.mixed.length === 0,
  );

  const other = { from: ref("core", 30, "core"), to: ref("core", 31, "core") };
  const mixed = checkChange(change, [change, other]);
  assert.ok(mixed.ok && mixed.warnings.length === 0);
  assert.deepStrictEqual(mixed.ok && mixed.mixed, [other]);
});

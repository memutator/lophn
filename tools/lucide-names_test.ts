import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { LUCIDE_NAMES_FILE, lucideNamesSource } from "./lucide-names.ts";

// 목록이 낡으면 prepare가 있는 icon 이름을 거절하거나 shell이 못 그리는 이름을 통과시킨다.
test("lucide icon 이름 목록은 shell의 lucide-react와 같다", async () => {
  assert.strictEqual(
    await readFile(LUCIDE_NAMES_FILE, "utf8"),
    await lucideNamesSource(),
    "node tools/lucide-names.ts 로 목록을 다시 만든다",
  );
});

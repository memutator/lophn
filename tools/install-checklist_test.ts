import assert from "node:assert/strict";
import { test } from "node:test";

import { buildChecklist, type Change } from "./install-checklist.ts";

const change = (version: string, id: string, checklist: string[]): Change => ({
  version,
  id,
  title: id,
  text: id,
  checklist,
});
const changes = [
  change("0.22.0", "old", ["옛 것"]),
  change("0.23.1", "a", ["해야: 앱을 다시 build한다", "화면을 본다"]),
  change("0.23.2", "b", []),
  change("0.23.3", "future", ["미래"]),
];

test("깔린 판 초과 설치할 판 이하의 항목만 모으고 downgrade는 경고만 낸다", () => {
  const up = buildChecklist({
    from: "0.22.0",
    to: "0.23.2",
    changes,
    notes: [],
  });
  assert.match(up, /- \[ \] 앱을 다시 build한다 \(0\.23\.1 a\)/);
  assert.match(up, /### 0\.23\.2/);
  assert.doesNotMatch(up, /옛 것|미래/);

  const down = buildChecklist({
    from: "0.23.3",
    to: "0.22.0",
    changes,
    notes: [],
  });
  assert.match(down, /downgrade/);
  assert.doesNotMatch(down, /### /);
});

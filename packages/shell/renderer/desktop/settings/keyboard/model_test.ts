import assert from "node:assert/strict";
import { test } from "node:test";

import { takeKeys, withKeys } from "./model.ts";

test("바꾸기는 새 키를 달고 다른 줄에서 그 키만 빼며, 표와 같아진 줄은 저장에서 빠진다", () => {
  const stored = {
    // Rename이 Next tab과 같은 키를 이미 쓴다. 이 키를 Close all이 가져가면 Rename은 표(키 없음)와 같아진다.
    other: { "tab.rename": ["Ctrl+Tab"] },
    mac: { "tab.rename": ["Cmd+KeyJ"] },
  };
  const taken = takeKeys("other", stored.other, {
    "tab.close-all": ["Ctrl+Tab"],
    // 번호 줄의 한 번호만 가져간다. tab.nth:2는 그대로다.
    "tab.reveal": ["Alt+Digit1"],
  });
  const next = withKeys(stored, "other", taken);
  assert.deepEqual(next.other, {
    "tab.close-all": ["Ctrl+Tab"],
    "tab.reveal": ["Alt+Digit1"],
    // Next tab은 Ctrl+PageDown만 남는다.
    "tab.next": ["Ctrl+PageDown"],
    "tab.nth:1": [],
  });
  // 다른 OS의 값은 건드리지 않는다.
  assert.deepEqual(next.mac, stored.mac);
});

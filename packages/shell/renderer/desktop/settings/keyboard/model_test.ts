import assert from "node:assert/strict";
import { test } from "node:test";

import {
  contributedDefaults,
  contributedRows,
  conflictClearKeys,
  takeKeys,
  withKeys,
} from "./model.ts";

test("바꾸기는 새 키를 달고 같은 context의 다른 줄에서 그 키만 빼며, 기본 키와 같아진 줄은 저장에서 빠진다", () => {
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

test("바꾸기는 context가 다른 줄의 같은 키를 빼지 않는다", () => {
  const overrides = { "agent.rewind": ["Ctrl+KeyJ"] };
  // 표에 context 없는 줄로 다는 키는 agentView의 Rewind에서 빼지 않는다.
  assert.deepEqual(
    takeKeys("other", overrides, { "tab.rename": ["Ctrl+KeyJ"] }),
    {
      "tab.rename": ["Ctrl+KeyJ"],
    },
  );
  // 같은 agentView context의 줄로 다는 키는 뺀다.
  assert.deepEqual(
    takeKeys("other", overrides, { "agent.queue": ["Ctrl+KeyJ"] }),
    {
      "agent.queue": ["Ctrl+KeyJ"],
      "agent.rewind": [],
    },
  );
});

test("기여가 없는 ext·app 저장 값은 다른 줄을 저장해도 남고, 기여가 그 id를 알면 기여의 기본 키와 비교한다", () => {
  const stored = {
    other: {
      "ext.harness-gui.rewind": ["Escape Escape"],
      "app.app_x.save": ["Ctrl+KeyS"],
      "tab.rename": ["Ctrl+KeyJ"],
    },
  };
  // 다른 줄 저장은 모르는 id의 값을 건드리지 않는다(sidebar의 키를 뺀 것도 남는다).
  assert.deepEqual(withKeys(stored, "other", { "sidebar.toggle": [] }).other, {
    "ext.harness-gui.rewind": ["Escape Escape"],
    "app.app_x.save": ["Ctrl+KeyS"],
    "tab.rename": ["Ctrl+KeyJ"],
    "sidebar.toggle": [],
  });

  const contributions = [
    {
      id: "ext.harness-gui.rewind",
      title: "Rewind",
      other: ["Escape Escape"],
      mac: ["Escape Escape"],
      source: "Extension: harness-gui",
    },
  ];
  // 기여의 기본 키로 되돌리면 저장에서 빠진다.
  assert.deepEqual(
    withKeys(
      stored,
      "other",
      { "ext.harness-gui.rewind": ["Escape Escape"] },
      contributedDefaults(contributions, "other"),
    ).other,
    {
      "app.app_x.save": ["Ctrl+KeyS"],
      "tab.rename": ["Ctrl+KeyJ"],
    },
  );

  // 지금 기여가 없는 id는 "없는 command" 줄로 남고 지울 수 있다.
  const rows = contributedRows([], "other", stored.other);
  assert.deepEqual(
    rows.map((row) => [
      row.kind === "single" ? row.id : "",
      row.kind === "single" && row.missing,
    ]),
    [
      ["ext.harness-gui.rewind", true],
      ["app.app_x.save", true],
    ],
  );
  assert.deepEqual(withKeys(stored, "other", { "app.app_x.save": [] }).other, {
    "ext.harness-gui.rewind": ["Escape Escape"],
    "tab.rename": ["Ctrl+KeyJ"],
  });
});

test("번호 줄의 Remove는 겹친 번호의 id만 비운다", () => {
  const keys = conflictClearKeys(
    ["tab.nth:1", "tab.nth:2", "tab.nth:3"],
    [
      {
        chord: "Alt+Digit3",
        ids: ["tab.nth:3", "tab.reveal"],
        reserved: false,
      },
    ],
  );
  assert.deepEqual(keys, { "tab.nth:3": [] });
});

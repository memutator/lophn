import assert from "node:assert/strict";
import { test } from "node:test";

import { readTabHead } from "./app-tab-head.ts";

test("앱이 보낸 머리 줄에서 글이 아닌 값은 shell까지 가지 않는다", () => {
  const rows: [unknown, unknown][] = [
    [null, null],
    ["tabs", null],
    [{ status: { $$typeof: "react.element" } }, null],
    [{ crumbs: [1, "  ", { a: 1 }] }, null],
    [{ actions: [{ id: "x", label: { a: 1 } }] }, null],
    [
      {
        crumbs: ["Sessions", 3],
        status: " 187 new ",
        tabs: {
          items: [
            { id: "a", label: "A" },
            { id: 2, label: "B" },
          ],
          selected: { id: "a" },
        },
        actions: [
          { id: "go", label: "Go", primary: "yes", busy: true },
          { id: "r", label: "Refresh", icon: "refresh" },
          { id: "z", label: "Zap", icon: "bogus" },
        ],
        menu: [{ id: "m", label: "M", disabled: 1 }],
        nav: { canBack: 1, canForward: true },
        extra: "<script>",
      },
      {
        crumbs: ["Sessions"],
        status: "187 new",
        tabs: { items: [{ id: "a", label: "A" }], selected: null },
        actions: [
          { id: "go", label: "Go", busy: true },
          { id: "r", label: "Refresh", icon: "refresh" },
          { id: "z", label: "Zap" },
        ],
        menu: [{ id: "m", label: "M" }],
        nav: { canBack: false, canForward: true },
      },
    ],
  ];
  for (const [input, expected] of rows) {
    assert.deepEqual(readTabHead(input), expected);
  }
});

test("머리 줄의 글과 항목 수는 상한에서 자른다", () => {
  const head = readTabHead({
    status: "x".repeat(500),
    menu: Array.from({ length: 100 }, (_, n) => ({ id: `${n}`, label: "m" })),
  });
  assert.equal(head?.status?.length, 80);
  assert.equal(head?.menu?.length, 24);
});

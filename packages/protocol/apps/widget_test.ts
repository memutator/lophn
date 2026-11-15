import assert from "node:assert/strict";
import { test } from "node:test";
import { widgetValueSchema } from "./widget.ts";

// AI가 쓴 앱의 값이 폰의 native 위젯에 닿는 경계다. 크기, 모르는 node, 길이, 범위 밖 값을 core 앞에서 거절한다.
const text = { kind: "text", text: "hello", style: "body" };
const rows = (n: number) => Array.from({ length: n }, () => text);
const list = (n: number) => ({
  kind: "list",
  items: Array.from({ length: n }, () => ({ text: "item" })),
});

test("widgetValueSchema rejects an oversized value, unknown kind, long text, bad progress and wrong row counts", () => {
  const ok = (value: unknown) => widgetValueSchema.safeParse(value).success;
  const wide = {
    kind: "list",
    items: Array.from({ length: 5 }, () => ({
      text: "가".repeat(32),
      trail: "나".repeat(12),
      tone: "warn",
    })),
  };
  const cases: [string, unknown, boolean][] = [
    ["a small value", { v: 1, rows: [text] }, true],
    [
      "every node kind",
      {
        v: 1,
        tone: "good",
        rows: [
          text,
          { kind: "stat", value: "42", label: "open" },
          { kind: "progress", value: 0.5 },
          list(5),
        ],
      },
      true,
    ],
    [
      "over 4 KiB",
      { v: 1, rows: Array.from({ length: 6 }, () => wide) },
      false,
    ],
    ["unknown node kind", { v: 1, rows: [{ kind: "image", src: "x" }] }, false],
    [
      "text over 48 chars",
      { v: 1, rows: [{ ...text, text: "a".repeat(49) }] },
      false,
    ],
    [
      "progress over 1",
      { v: 1, rows: [{ kind: "progress", value: 1.1 }] },
      false,
    ],
    [
      "progress under 0",
      { v: 1, rows: [{ kind: "progress", value: -0.1 }] },
      false,
    ],
    ["no rows", { v: 1, rows: [] }, false],
    ["seven rows", { v: 1, rows: rows(7) }, false],
    ["empty list", { v: 1, rows: [list(0)] }, false],
    ["six list items", { v: 1, rows: [list(6)] }, false],
    ["extra field", { v: 1, rows: [text], extra: 1 }, false],
  ];
  for (const [name, value, expected] of cases) {
    assert.equal(ok(value), expected, name);
  }
});

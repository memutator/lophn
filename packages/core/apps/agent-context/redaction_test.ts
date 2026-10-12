import { assert, assertEquals } from "@std/assert";
import {
  DATA_MAX_DEPTH,
  limitSummary,
  prepareScreenContext,
  SUMMARY_MAX_BYTES,
  utf8Length,
} from "./mod.ts";

const SECRET = "private-note-9f3c";

function state() {
  return {
    summary: "Fixing todo 7: add a retry to the export",
    data: {
      code: "export function run() {}",
      attempts: [
        { n: 1, result: "failed", note: SECRET },
        { n: 2, result: "passed", note: "second-note-77aa" },
      ],
      private_note: SECRET,
    },
  };
}

Deno.test("apps/agent-context#R4: sensitive paths are removed from the detail and listed without values", () => {
  const prepared = prepareScreenContext({
    ...state(),
    detail: true,
    sensitive_paths: ["/data/private_note", "/data/attempts/0/note"],
  });
  assertEquals(prepared.redacted, [
    "/data/attempts/0/note",
    "/data/private_note",
  ]);
  const text = JSON.stringify(prepared);
  assert(!text.includes(SECRET), text);
  assertEquals(prepared.data?.attempts, [
    { n: 1, result: "failed" },
    { n: 2, result: "passed", note: "second-note-77aa" },
  ]);
});

Deno.test("apps/agent-context#R4: a parent path removes everything below it", () => {
  const prepared = prepareScreenContext({
    ...state(),
    detail: true,
    sensitive_paths: ["/data/attempts"],
  });
  // attempts 아래에 있던 값을 담은 private_note도 같은 값이라 함께 지운다.
  assertEquals(prepared.data, { code: "export function run() {}" });
  assertEquals(prepared.redacted, ["/data/attempts", "/data/private_note"]);
  assert(!JSON.stringify(prepared).includes(SECRET));
});

Deno.test("apps/agent-context#R4: removing several array items by index does not shift into a leak", () => {
  const prepared = prepareScreenContext({
    summary: "list",
    data: { notes: ["keep-me-1", "drop-me-2222", "drop-me-3333", "keep-me-4"] },
    detail: true,
    sensitive_paths: ["/data/notes/1", "/data/notes/2"],
  });
  assertEquals(prepared.data, { notes: ["keep-me-1", "keep-me-4"] });
  assertEquals(prepared.redacted, ["/data/notes/1", "/data/notes/2"]);
});

Deno.test("apps/agent-context#R4: a sensitive value copied into the summary withholds the summary", () => {
  const prepared = prepareScreenContext({
    summary: `Note says ${SECRET}.`,
    data: { private_note: SECRET },
    detail: false,
    sensitive_paths: ["/data/private_note"],
  });
  assertEquals(prepared.summary, "");
  assertEquals(prepared.redacted, ["/data/private_note", "/summary"]);
  assert(!JSON.stringify(prepared).includes(SECRET));
});

Deno.test("apps/agent-context#R4: a sensitive value copied into another data field is removed too", () => {
  const prepared = prepareScreenContext({
    summary: "ok",
    data: { private_note: SECRET, draft: `copy of ${SECRET}`, title: "Todo" },
    detail: true,
    sensitive_paths: ["/data/private_note"],
  });
  assertEquals(prepared.data, { title: "Todo" });
  assertEquals(prepared.redacted, ["/data/draft", "/data/private_note"]);
});

Deno.test("apps/agent-context#R4: data that cannot be verified is omitted and only the omission is reported", () => {
  const cyclic: Record<string, unknown> = { a: 1 };
  cyclic.self = cyclic;
  for (
    const data of [
      cyclic,
      { when: new Date() },
      { fn: () => 1 },
      { big: 10n },
      { nan: Number.NaN },
      [1, 2],
      "text",
    ]
  ) {
    const prepared = prepareScreenContext({
      summary: "s",
      data,
      detail: true,
      sensitive_paths: ["/data/private_note"],
    });
    assertEquals(prepared.data, null);
    assertEquals(prepared.redacted, ["/data"]);
    assertEquals(prepared.summary, "s");
  }
  let deep: Record<string, unknown> = { leaf: true };
  for (let level = 0; level <= DATA_MAX_DEPTH; level += 1) deep = { deep };
  assertEquals(
    prepareScreenContext({
      summary: "s",
      data: deep,
      detail: true,
      sensitive_paths: [],
    }).data,
    null,
  );
});

Deno.test("apps/agent-context#R4: a sensitive path outside summary and data withholds everything", () => {
  for (const path of ["/secret", "", "data", "/data/~2"]) {
    const prepared = prepareScreenContext({
      ...state(),
      detail: true,
      sensitive_paths: [path],
    });
    assertEquals(prepared.summary, "");
    assertEquals(prepared.data, null);
    assertEquals(prepared.redacted, [path]);
  }
});

Deno.test("apps/agent-context#R4: __proto__ keys stay own keys and a sensitive one is removed by name", () => {
  const data = JSON.parse(
    '{"__proto__":{"attempt":"current"},"nested":{"__proto__":"hidden-value-1"}}',
  );
  const kept = prepareScreenContext({
    summary: "s",
    data,
    detail: true,
    sensitive_paths: ["/data/nested/__proto__"],
  });
  assertEquals(
    JSON.stringify(kept.data),
    '{"__proto__":{"attempt":"current"},"nested":{}}',
  );
  assertEquals(kept.redacted, ["/data/nested/__proto__"]);
  assertEquals(Object.prototype.hasOwnProperty.call({}, "attempt"), false);
});

Deno.test("apps/agent-context#R3: the summary stays within 2048 UTF-8 bytes at a code point boundary", () => {
  for (
    const text of [
      "a".repeat(5000),
      "가".repeat(5000),
      "😀".repeat(3000),
      `${"a".repeat(2047)}가`,
    ]
  ) {
    const prepared = prepareScreenContext({
      summary: text,
      data: { code: text },
      detail: false,
      sensitive_paths: [],
    });
    assert(utf8Length(prepared.summary) <= SUMMARY_MAX_BYTES);
    assert(prepared.summary.endsWith("…"));
    assert(!prepared.summary.includes("�"));
    // 짧은 요약은 그대로다.
    assertEquals(limitSummary("short"), "short");
  }
  assertEquals(
    utf8Length(limitSummary("a".repeat(SUMMARY_MAX_BYTES))),
    SUMMARY_MAX_BYTES,
  );
});

Deno.test("apps/agent-context#R3: detail is returned only when asked", () => {
  const summaryOnly = prepareScreenContext({
    ...state(),
    detail: false,
    sensitive_paths: [],
  });
  assert(!("data" in summaryOnly));
  const detailed = prepareScreenContext({
    ...state(),
    detail: true,
    sensitive_paths: [],
  });
  assertEquals(detailed.data, state().data);
  assertEquals(detailed.redacted, []);
  // 상세가 없으면 null이다.
  assertEquals(
    prepareScreenContext({
      summary: "s",
      detail: true,
      sensitive_paths: [],
    }).data,
    null,
  );
});

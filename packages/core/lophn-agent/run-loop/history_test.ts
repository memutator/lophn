import assert from "node:assert/strict";
import { test } from "node:test";
import type { HistoryMessage } from "../prompt-assembly/mod.ts";
import {
  OMITTED_RESULT,
  omitOldImages,
  omitOldToolResults,
} from "./history.ts";

// n번 tool 호출이 각각 이미지 하나를 낸 history다.
function historyWith(images: number): HistoryMessage[] {
  const history: HistoryMessage[] = [];
  for (let i = 0; i < images; i++) {
    history.push(
      {
        role: "assistant",
        parts: [{ kind: "tool_use", id: `t${i}`, name: "read", input: {} }],
      },
      {
        role: "user",
        parts: [
          { kind: "tool_result", id: `t${i}`, text: `r${i}` },
          {
            kind: "tool_result_image",
            id: `t${i}`,
            media_type: "image/png",
            data_base64: `img${i}`,
          },
        ],
      },
    );
  }
  return history;
}

test("이미지가 2개를 넘으면 오래된 것부터 빠지고 짝 글에 표시가 붙는다", () => {
  for (const count of [0, 2, 3, 5]) {
    const input = historyWith(count);
    const before = structuredClone(input);
    const out = omitOldImages(input, 2);
    assert.deepStrictEqual(input, before);

    const omitted = Math.max(0, count - 2);
    const parts = out.flatMap((m) => m.parts);
    const images = parts.filter((p) => p.kind === "tool_result_image");
    assert.deepStrictEqual(
      images.map((p) => p.id),
      Array.from({ length: count - omitted }, (_, i) => `t${omitted + i}`),
    );
    for (let i = 0; i < count; i++) {
      assert.deepStrictEqual(
        parts.filter((p) => p.kind === "tool_use" && p.id === `t${i}`).length,
        1,
      );
      assert.deepStrictEqual(
        parts.filter(
          (p) =>
            p.kind === "tool_result" &&
            p.id === `t${i}` &&
            p.text === (i < omitted ? `r${i}\n[image omitted]` : `r${i}`),
        ).length,
        1,
      );
    }
  }
});

// tool 묶음 n개. 각 결과 본문은 약 1,000 token이고 t1은 skill 본문이다.
function batches(count: number): HistoryMessage[] {
  const history: HistoryMessage[] = [];
  for (let i = 0; i < count; i++) {
    const name = i === 1 ? "skill_read" : "file_read";
    history.push(
      {
        role: "assistant",
        parts: [{ kind: "tool_use", id: `t${i}`, name, input: {} }],
      },
      {
        role: "user",
        parts: [{ kind: "tool_result", id: `t${i}`, text: "x".repeat(3000) }],
      },
    );
  }
  return history;
}

test("오래된 tool 결과를 줄여도 짝은 남고, 최근 두 묶음과 skill 본문은 그대로이고, 같은 입력은 같은 결과다", () => {
  const input = batches(6);
  const before = structuredClone(input);
  const first = omitOldToolResults(input, 1_000_000);
  assert.deepStrictEqual(input, before);
  assert.deepStrictEqual(omitOldToolResults(input, 1_000_000), first);

  const results = first.history.flatMap((m) =>
    m.parts.filter((p) => p.kind === "tool_result"),
  );
  assert.deepStrictEqual(
    results.map((p) => (p.text === OMITTED_RESULT ? "omitted" : p.id)),
    ["omitted", "t1", "omitted", "omitted", "t4", "t5"],
  );
  for (let i = 0; i < 6; i++) {
    const parts = first.history.flatMap((m) => m.parts);
    assert.ok(parts.some((p) => p.kind === "tool_use" && p.id === `t${i}`));
    assert.ok(parts.some((p) => p.kind === "tool_result" && p.id === `t${i}`));
  }

  // 필요한 만큼만, 오래된 것부터 줄인다. 이미 줄인 것은 다시 세지 않는다.
  const one = omitOldToolResults(input, 500);
  assert.deepStrictEqual(
    one.history
      .flatMap((m) => m.parts)
      .flatMap((p) =>
        p.kind === "tool_result" && p.text === OMITTED_RESULT ? [p.id] : [],
      ),
    ["t0"],
  );
  assert.deepStrictEqual(omitOldToolResults(one.history, 0).freed, 0);
  assert.deepStrictEqual(omitOldToolResults(first.history, 1_000_000).freed, 0);
});

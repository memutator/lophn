import assert from "node:assert/strict";
import { test } from "node:test";

import type { AgentEvent } from "../../../protocol/events/mod.ts";
import { foldDelta, liveFromWriting, type LiveText } from "./live-text.ts";

type Delta = Extract<AgentEvent, { type: "ModelOutputStreamed" }>["payload"];

const AT = "2026-10-26T09:00:00.000Z";

function delta(
  modelCall: string,
  kind: Delta["kind"],
  offset: number,
  text: string,
): Delta {
  return {
    turn: "trn_01h455vb4pex5v6nkc6gd5f001",
    model_call: modelCall,
    kind,
    offset,
    text,
  };
}

function stateOf(live: LiveText) {
  return {
    text: live.text,
    reasoning: live.reasoning,
    modelCall: live.modelCall,
    gap: live.gap,
  };
}

// snapshot에서 출발해 delta를 차례로 접는다. 표의 기대는 그 조각을 접은 뒤의 글이다.
test("retry된 attempt의 글은 live 글에 남지 않고 겹친 delta는 두 번 붙지 않는다", () => {
  const start = liveFromWriting({
    turn: "trn_01h455vb4pex5v6nkc6gd5f001",
    model_call: "mcl_01h455vb4pex5v6nkc6gd5f001",
    text: "Hel",
    reasoning: "",
  }, AT);
  if (start === null) {
    throw new Error("snapshot writing must start a live text");
  }

  const rows: readonly {
    readonly name: string;
    readonly delta: Delta;
    readonly expected: ReturnType<typeof stateOf>;
  }[] = [
    {
      name: "snapshot 뒤의 조각은 앞 글에 이어진다",
      delta: delta("mcl_01h455vb4pex5v6nkc6gd5f001", "text", 3, "lo"),
      expected: {
        text: "Hello",
        reasoning: "",
        modelCall: "mcl_01h455vb4pex5v6nkc6gd5f001",
        gap: false,
      },
    },
    {
      name: "이미 가진 글과 겹치는 조각은 두 번 붙지 않는다",
      delta: delta("mcl_01h455vb4pex5v6nkc6gd5f001", "text", 0, "Hello"),
      expected: {
        text: "Hello",
        reasoning: "",
        modelCall: "mcl_01h455vb4pex5v6nkc6gd5f001",
        gap: false,
      },
    },
    {
      name: "반쯤 겹치는 조각은 겹치지 않은 부분만 붙는다",
      delta: delta("mcl_01h455vb4pex5v6nkc6gd5f001", "text", 4, "o wor"),
      expected: {
        text: "Hello wor",
        reasoning: "",
        modelCall: "mcl_01h455vb4pex5v6nkc6gd5f001",
        gap: false,
      },
    },
    {
      name: "다른 model 호출(retry)의 조각이면 앞 attempt의 글은 남지 않는다",
      delta: delta("mcl_01h455vb4pex5v6nkc6gd5f002", "text", 0, "Hi"),
      expected: {
        text: "Hi",
        reasoning: "",
        modelCall: "mcl_01h455vb4pex5v6nkc6gd5f002",
        gap: false,
      },
    },
    {
      name: "앞 글 길이를 넘는 offset은 붙이지 않고 gap만 세운다",
      delta: delta("mcl_01h455vb4pex5v6nkc6gd5f002", "text", 5, "x"),
      expected: {
        text: "Hi",
        reasoning: "",
        modelCall: "mcl_01h455vb4pex5v6nkc6gd5f002",
        gap: true,
      },
    },
    {
      name: "reasoning은 text와 따로 센다",
      delta: delta("mcl_01h455vb4pex5v6nkc6gd5f002", "reasoning", 0, "plan"),
      expected: {
        text: "Hi",
        reasoning: "plan",
        modelCall: "mcl_01h455vb4pex5v6nkc6gd5f002",
        gap: true,
      },
    },
  ];

  let live: LiveText = start;
  for (const row of rows) {
    live = foldDelta(live, row.delta, AT);
    assert.deepStrictEqual(stateOf(live), row.expected, row.name);
  }
});

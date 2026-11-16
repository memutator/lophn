import assert from "node:assert/strict";
import { test } from "node:test";

import { PHONE_KINDS } from "./kinds.ts";

const view = "view-abcdef01";
const by = "Someone on your computer";

test("each drive kind accepts one input and one output", () => {
  const cases: [keyof typeof PHONE_KINDS, unknown, unknown][] = [
    [
      "drive.snapshot",
      { view, by },
      {
        snapshot: "s1",
        width_dp: 411,
        height_dp: 891,
        nodes: [
          {
            node: 1,
            depth: 0,
            role: "button",
            name: "Save",
            flags: ["offscreen"],
          },
        ],
      },
    ],
    [
      "drive.act",
      { view, by, snapshot: "s1", act: { type: "fill", node: 2, text: "hi" } },
      {},
    ],
    [
      "drive.screenshot",
      { view, by, format: "jpeg" },
      {
        media_type: "image/jpeg",
        data_base64: "AAAA",
        width: 1080,
        height: 2340,
      },
    ],
    [
      "drive.wait",
      { view, by, text: "Done", timeout_ms: 1000 },
      { found: true },
    ],
  ];
  for (const [kind, input, output] of cases) {
    const spec = PHONE_KINDS[kind];
    assert.equal(spec.input.safeParse(input).success, true, kind);
    assert.equal(spec.output.safeParse(output).success, true, kind);
  }
});

test("drive.act rejects an unknown type and a press key other than Enter", () => {
  const act = (value: unknown) =>
    PHONE_KINDS["drive.act"].input.safeParse({
      view,
      by,
      snapshot: "s1",
      act: value,
    }).success;
  assert.equal(act({ type: "press", key: "Enter" }), true);
  assert.equal(act({ type: "hover", node: 1 }), false);
  assert.equal(act({ type: "press", key: "Back" }), false);
});

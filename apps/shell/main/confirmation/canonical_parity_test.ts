// shell canonical과 core confirmationBinding이 같은 bytes·hash를 내는지 본다.
// 이 파일은 shell tsc include가 아니다. deno test만 @lophn/base를 불러 대조한다.
import assert from "node:assert/strict";
import { test } from "node:test";

import { canonicalize as coreCanonicalize, sha256Hex } from "@lophn/base";

import { canonicalize as shellCanonicalize } from "./canonical.ts";
import { contentBasis } from "./handle.ts";

const fixtures: { name: string; value: unknown }[] = [
  {
    name: "key-order",
    value: { binding_hash: "b", approval: "apr_1", created_seq: "9" },
  },
  {
    name: "integer-looking-key",
    value: { "10": { z: 1, a: true }, "2": null, "01": "kept" },
  },
  {
    name: "unicode",
    value: {
      note: "결정 확인 — café \u0000  ",
      "이름": "값",
    },
  },
  {
    name: "nested-array",
    value: {
      targets: ["b", { inner: [1, { z: 0, a: "가" }, null] }, false],
      n: 0,
      neg: -0,
      big: 1.5,
    },
  },
];

for (const fixture of fixtures) {
  test(`shell/confirmation-window#R6: ${fixture.name} canonical bytes와 hash가 core와 같다`, async () => {
    const shell = shellCanonicalize(fixture.value);
    const core = coreCanonicalize(fixture.value);
    assert.equal(shell, core);
    assert.equal(contentBasis(fixture.value), await sha256Hex(core));
  });
}

test("shell/confirmation-window#R6: 유한하지 않은 수는 두 구현이 같이 거부한다", () => {
  assert.throws(() => shellCanonicalize(Number.NaN), TypeError);
  assert.throws(() => coreCanonicalize(Number.NaN), TypeError);
});

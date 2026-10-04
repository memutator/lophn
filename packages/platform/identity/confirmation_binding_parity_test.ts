// shell이 만드는 내용 기준이 confirmationBinding과 같은 bytes·hash인지 본다.
// shell tsc graph에 base를 넣지 않으려고 대조는 이쪽 deno test에 둔다.
import { assertEquals, assertRejects, assertThrows } from "@std/assert";

import { sha256Hex } from "../../base/mod.ts";
import { canonicalize as shellCanonicalize } from "../../../apps/shell/main/confirmation/canonical.ts";
import { confirmationBinding } from "./confirmation-binding.ts";

const fixtures: {
  name: string;
  fields: readonly string[];
  input: Record<string, unknown>;
}[] = [
  {
    name: "key-order",
    fields: ["approval", "created_seq", "binding_hash"],
    input: {
      binding_hash: "b",
      approval: "apr_1",
      created_seq: "9",
      ignored: "not-bound",
    },
  },
  {
    name: "integer-looking-key",
    fields: ["target", "payload"],
    input: {
      target: "row",
      payload: { "10": { z: 1, a: true }, "2": null, "01": "kept" },
    },
  },
  {
    name: "unicode",
    fields: ["target", "note"],
    input: {
      note: "결정 확인 — café \u0000  ",
      target: "이름",
    },
  },
  {
    name: "nested-array",
    fields: ["target", "targets", "n", "neg", "big"],
    input: {
      target: "doc",
      targets: ["b", { inner: [1, { z: 0, a: "가" }, null] }, false],
      n: 0,
      neg: -0,
      big: 1.5,
    },
  },
];

for (const fixture of fixtures) {
  Deno.test(
    `shell/confirmation-window#R6: ${fixture.name} canonical bytes와 hash가 core와 같다`,
    async () => {
      const bound: Record<string, unknown> = {};
      for (const field of fixture.fields) bound[field] = fixture.input[field];
      const bytes = shellCanonicalize(bound);
      const core = await confirmationBinding(
        { binding: fixture.fields },
        fixture.input,
      );
      if (core === undefined) throw new Error("binding missing");
      assertEquals(await sha256Hex(bytes), core.content);
      assertEquals(core.target, fixture.input[fixture.fields[0]]);
    },
  );
}

Deno.test("shell/confirmation-window#R6: 유한하지 않은 수는 두 구현이 같이 거부한다", async () => {
  const value = { target: "row", n: Number.NaN };
  assertThrows(() => shellCanonicalize(value), TypeError);
  await assertRejects(
    () => confirmationBinding({ binding: ["target", "n"] }, value),
    TypeError,
  );
});

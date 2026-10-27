import assert from "node:assert/strict";
import { test } from "node:test";

import { createProductRedactor } from "./product-redactor.ts";
import { REDACTION_REPLACEMENT } from "./model.ts";

const source = { concern: "c", revision: "r", scope: "s" };

function known(secret: string, ready: boolean) {
  return {
    ready,
    match(text: string) {
      const index = text.indexOf(secret);
      return index < 0 ? undefined : { index, length: secret.length };
    },
  };
}

test("known secrets and prefixed credentials are replaced", () => {
  const redact = createProductRedactor(known("hunter2-value", true));
  const out = redact(
    source,
    "text/plain",
    "a hunter2-value b sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789 c",
  );
  assert.deepStrictEqual(
    out,
    `a ${REDACTION_REPLACEMENT} b ${REDACTION_REPLACEMENT} c`,
  );
});

test("returns null while known secrets are not all loaded", () => {
  const redact = createProductRedactor(known("hunter2-value", false));
  assert.deepStrictEqual(redact(source, "text/plain", "hunter2-value"), null);
});

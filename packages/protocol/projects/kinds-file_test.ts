import assert from "node:assert/strict";
import { test } from "node:test";

import {
  checkKindsStructure,
  type KindsFile,
  kindsFileSchema,
} from "./kinds-file.ts";

const note = {
  name: "note",
  summary: "meeting notes",
  files: ["notes/*.md"],
  key: "slug",
  fields: {
    slug: {
      type: "string" as const,
      from: "path" as const,
      capture: "notes/{slug}.md",
    },
    owner: { type: "ref" as const, to: "person" },
  },
};
const person = {
  name: "person",
  summary: "people",
  files: ["people/*.md"],
  key: "file",
  fields: {},
};

function rulesOf(patch: (file: { kinds: Record<string, unknown>[] }) => void) {
  const file = structuredClone({ kinds: [note, person] }) as {
    kinds: Record<string, unknown>[];
  };
  patch(file);
  return checkKindsStructure(kindsFileSchema.parse(file) as KindsFile).map(
    (e) => `${e.rule}:${e.kind}:${e.field}`,
  );
}

test("checkKindsStructure가 틀린 kind 파일을 규칙별로 잡고 맞는 파일은 통과시킨다", () => {
  const field =
    (kind: number, name: string) =>
    (file: { kinds: Record<string, unknown>[] }) =>
      (file.kinds[kind].fields as Record<string, Record<string, unknown>>)[
        name
      ];
  const cases: [
    string,
    (file: { kinds: Record<string, unknown>[] }) => void,
    string[],
  ][] = [
    ["valid", () => {}, []],
    [
      "duplicate kind",
      (f) => f.kinds.push({ ...f.kinds[1], files: ["other/*.md"] }),
      ["duplicate_kind:person:null"],
    ],
    [
      "unknown ref target",
      (f) => (field(0, "owner")(f).to = "nobody"),
      ["unknown_kind:note:owner"],
    ],
    [
      "undeclared key",
      (f) => (f.kinds[0].key = "title"),
      ["bad_key:note:title"],
    ],
    [
      "capture without the field",
      (f) => (field(0, "slug")(f).capture = "notes/{title}.md"),
      ["bad_capture:note:slug"],
    ],
    [
      "capture with the field twice",
      (f) => (field(0, "slug")(f).capture = "{slug}/{slug}.md"),
      ["bad_capture:note:slug"],
    ],
    [
      "pattern that does not compile",
      (f) => {
        const owner = field(0, "owner")(f);
        delete owner.to;
        owner.type = "string";
        owner.pattern = "(";
      },
      ["bad_pattern:note:owner"],
    ],
    [
      "absolute glob",
      (f) => (f.kinds[0].files = ["/etc/*.md"]),
      ["bad_glob:note:null"],
    ],
    [
      "glob with ..",
      (f) => (f.kinds[0].files = ["../x/*.md"]),
      ["bad_glob:note:null"],
    ],
    [
      "glob with backslash",
      (f) => (f.kinds[0].files = ["a\\b.md"]),
      ["bad_glob:note:null"],
    ],
    [
      "same glob in two kinds",
      (f) => (f.kinds[1].files = ["notes/*.md"]),
      ["duplicate_glob:person:null"],
    ],
  ];
  for (const [name, patch, expected] of cases) {
    assert.deepStrictEqual(rulesOf(patch), expected, name);
  }
});

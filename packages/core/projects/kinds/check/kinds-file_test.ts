import { assertEquals } from "@std/assert";
import type { Kind } from "../../../../protocol/projects/mod.ts";
import { type AppliedKinds, applyKindsFile } from "./kinds-file.ts";

const valid = `kinds:
  - name: note
    summary: a note
    files: [notes/*.md]
    key: file
`;
const validKinds: Kind[] = [{
  name: "note",
  summary: "a note",
  files: ["notes/*.md"],
  key: "file",
  fields: {},
}];
const previous: AppliedKinds = { hash: "previous-hash", kinds: validKinds };

const noFiles = () => [];

Deno.test("틀린 kinds 파일은 앞의 맞던 kind를 그대로 쓰게 하고, 파일이 없으면 적용 중이던 kind를 버린다", () => {
  const syntax = "kinds: [";
  const structure = valid.replace("key: file", "key: missing");
  const overlap = `${valid}  - name: other
    summary: another
    files: [notes/a.md]
    key: file
`;
  const withNoteFile = () => ["notes/a.md"];
  const cases: {
    name: string;
    text: string | null;
    previous: AppliedKinds | null;
    files?: () => string[];
    want: { state: string; using: string; kinds: Kind[] | null; rule?: string };
  }[] = [
    {
      name: "yaml 문법 오류, 앞의 것이 있다",
      text: syntax,
      previous,
      want: {
        state: "invalid",
        using: "previous",
        kinds: validKinds,
        rule: "kinds_syntax",
      },
    },
    {
      name: "구조 오류, 앞의 것이 없다",
      text: structure,
      previous: null,
      want: { state: "invalid", using: "none", kinds: null, rule: "bad_key" },
    },
    {
      name: "구조 오류, 앞의 것이 있다",
      text: structure,
      previous,
      want: {
        state: "invalid",
        using: "previous",
        kinds: validKinds,
        rule: "bad_key",
      },
    },
    {
      name: "바뀐 파일에서 glob이 겹친다",
      text: overlap,
      previous,
      files: withNoteFile,
      want: {
        state: "invalid",
        using: "previous",
        kinds: validKinds,
        rule: "glob_overlap",
      },
    },
    {
      name: "파일이 없으면 적용 중이던 것도 버린다",
      text: null,
      previous,
      want: { state: "none", using: "none", kinds: null },
    },
    {
      name: "맞는 파일은 바로 쓴다",
      text: valid,
      previous,
      want: { state: "valid", using: "current", kinds: validKinds },
    },
  ];
  for (const c of cases) {
    const result = applyKindsFile({
      text: c.text,
      previous: c.previous,
      files: c.files ?? noFiles,
    });
    assertEquals(
      {
        state: result.state,
        using: result.using,
        kinds: result.kinds,
        rule: result.errors[0]?.rule,
      },
      { ...c.want, rule: c.want.rule },
      c.name,
    );
  }
});

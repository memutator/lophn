import { assertEquals } from "@std/assert";
import { changed, sampleBundle, sampleEnv } from "./sample.ts";
import { checkSources } from "./sources.ts";
import { type ContractIssue, sortIssues } from "./types.ts";
import type { BundleContent } from "../../../contracts/documents/mod.ts";

const issues = (bundle: BundleContent): ContractIssue[] =>
  sortIssues(checkSources(bundle, sampleEnv()));
const at = (code: ContractIssue["code"], ...path: (string | number)[]) => ({
  code,
  path,
});
// types: 0 Experiment(series) 1 Scenario(docs) 2 Finding(series) 3 Decision(section)
//        4 Guide(index) 5 GuideHeading(outline) 6 Event(app-data)
const SOURCE = (type: number, ...rest: string[]) =>
  ["contract", "types", type, "source", ...rest] as const;

Deno.test("documents/contexts#R5 [ctx-I1]: the sample contract has no source issues", () => {
  assertEquals(issues(sampleBundle()), []);
});

Deno.test("documents/series#R2 [ctx-I1]: series patterns follow the documents/series grammar", () => {
  const withPattern = (pattern: string) =>
    issues(changed((b) => b.contract.types[0].source.pattern = pattern));
  for (
    const good of [
      "reports/weekly-{n}.md",
      "eval/experiments/exp-{n+1:03}-*.md",
      "v{n-1}.md",
      "weekly-{minor}.md",
      "notes/{major}.md",
      "P{n+1:04}.md",
    ]
  ) assertEquals(withPattern(good), [], good);
  for (
    const bad of [
      "eval/experiments/exp.md", // 번호 자리 없음
      "eval/exp-{n}-{n}.md", // 번호 자리 둘
      "eval/{n}/summary.md", // 폴더 칸의 번호 자리
      "eval/*/exp-{n}.md", // 폴더 칸의 *
      "../eval/exp-{n}.md", // project 밖
      "/eval/exp-{n}.md", // 절대 경로
      "eval//exp-{n}.md", // 빈 칸
      "eval/exp-{n:0}.md", // width 0
      "eval/exp-{n:5}.md", // width 5
      "eval/exp1{n}.md", // 번호 자리 앞 숫자
      "eval/exp-{n}*.md", // 번호 자리 뒤 *
      "eval/exp-{n}.1.md", // 번호 자리 뒤 . 다음 숫자
      "eval/exp-{x}.md", // 모르는 번호 자리
      " eval/exp-{n}.md", // 바깥 공백
    ]
  ) {
    assertEquals(
      withPattern(bad),
      [at("series_pattern_invalid", ...SOURCE(0, "pattern"))],
      bad,
    );
  }
});

Deno.test("documents/series#R1 [ctx-I1]: one pattern belongs to one type; later types reuse it as an overlap", () => {
  assertEquals(
    issues(changed((b) => {
      b.contract.types[2].source.pattern = b.contract.types[0].source.pattern;
    })),
    [at("series_pattern_overlap", ...SOURCE(2, "pattern"))],
  );
});

Deno.test("documents/contexts#R9 #R10 [ctx-I1]: from_type names another type of the same contract", () => {
  assertEquals(
    issues(changed((b) => b.contract.types[5].source.from_type = "Manual")),
    [at("from_type_unknown", ...SOURCE(5, "from_type"))],
  );
  assertEquals(
    issues(
      changed((b) => b.contract.types[5].source.from_type = "GuideHeading"),
    ),
    [at("from_type_self", ...SOURCE(5, "from_type"))],
  );
  assertEquals(
    issues(changed((b) => {
      b.contract.types[3].source = {
        kind: "section",
        from_type: "Nope",
        level: 2,
      };
    })),
    [at("from_type_unknown", ...SOURCE(3, "from_type"))],
  );
  assertEquals(
    issues(changed((b) => {
      b.contract.types[3].source = {
        kind: "section",
        from_type: "Guide",
        level: 2,
      };
    })),
    [],
  );
});

Deno.test("documents/contexts#R8 [ctx-I1]: an index is a Markdown document", () => {
  for (const document of ["docs/README.md", "docs/INDEX.Markdown"]) {
    assertEquals(
      issues(changed((b) => b.contract.types[4].source.document = document)),
      [],
      document,
    );
  }
  assertEquals(
    issues(
      changed((b) => b.contract.types[4].source.document = "docs/README.txt"),
    ),
    [at("index_not_markdown", ...SOURCE(4, "document"))],
  );
});

Deno.test("documents/contexts#R12 [ctx-I1]: app-data uses a known read command only", () => {
  const withCommand = (command: string) =>
    issues(changed((b) => b.contract.types[6].source.command = command));
  assertEquals(withCommand("events.lost"), [
    at("app_command_unknown", ...SOURCE(6, "command")),
  ]);
  assertEquals(withCommand("events.create"), [
    at("app_command_not_read", ...SOURCE(6, "command")),
  ]);
  assertEquals(withCommand("invites.send"), [
    at("app_command_not_read", ...SOURCE(6, "command")),
  ]);
  assertEquals(
    issues(changed((b) => b.contract.types[6].source.app = "mail")),
    [at("app_command_unknown", ...SOURCE(6, "command"))],
  );
});

Deno.test("documents/contexts#R6 [ctx-I1]: issues come out in path order and the check is pure", () => {
  const bundle = changed((b) => {
    b.contract.types[6].source.command = "events.create";
    b.contract.types[0].source.pattern = "eval/exp.md";
    b.contract.types[4].source.document = "README.txt";
  });
  const first = checkSources(bundle, sampleEnv());
  assertEquals(first, sortIssues(first));
  assertEquals(first, [
    at("series_pattern_invalid", ...SOURCE(0, "pattern")),
    at("index_not_markdown", ...SOURCE(4, "document")),
    at("app_command_not_read", ...SOURCE(6, "command")),
  ]);
  assertEquals(checkSources(bundle, sampleEnv()), first);
});

import { assert, assertEquals } from "@std/assert";
import { checkRepo, checkSource, errorsOf } from "./check.ts";
import { en } from "./en.ts";

const root = new URL("../../../", import.meta.url).pathname;

function fixture(
  file: string,
): { source: string; catalog: Record<string, string> } {
  const source = Deno.readTextFileSync(
    new URL(`./testdata/${file}`, import.meta.url),
  );
  return { source, catalog: file.endsWith(".json") ? JSON.parse(source) : en };
}

function rules(file: string): string[] {
  const { source, catalog } = fixture(file);
  const known = file.endsWith(".json") ? ["problems.code.missing_details"] : [];
  return checkSource(`testdata/${file}`, source, catalog, { knownKeys: known })
    .map((finding) => `${finding.severity}:${finding.rule}`);
}

Deno.test("shell/wording#R7: 화면 코드의 직접 문구와 없는 key는 오류다", () => {
  const found = rules("literal.txt");
  assert(found.includes("error:literal-text"));
  assert(found.includes("error:literal-attribute"));
  assert(found.includes("error:unknown-key"));
});

Deno.test("shell/wording#R7: 빈 en 값, ICU 문법 오류, 다른 concern의 key 재정의는 오류다", () => {
  const found = rules("catalog.json");
  assert(found.includes("error:empty-message"));
  assert(found.includes("error:icu-syntax"));
  assert(found.includes("error:owned-elsewhere"));
  assert(found.includes("error:key-shape"));
});

Deno.test("shell/wording#R1: 문장 key는 마침표를 요구하고 버튼·제목 key는 마침표를 거절한다", () => {
  const found = rules("catalog.json");
  assert(found.includes("error:missing-period"));
  assert(found.includes("error:extra-period"));
});

Deno.test("shell/wording#R6: snake_case, ID 접두사, 원시 enum, 안쪽 개념 단어는 경고다", () => {
  const found = rules("catalog.json");
  for (
    const rule of [
      "warning:snake-case",
      "warning:id-prefix",
      "warning:raw-enum",
      "warning:internal-word",
    ]
  ) assert(found.includes(rule), rule);
});

Deno.test("shell/wording#R6: 개발자 diagnostics key의 안쪽 개념 단어는 경고하지 않는다", () => {
  const { source, catalog } = fixture("catalog.json");
  const findings = checkSource("testdata/catalog.json", source, catalog);
  const diagnostics = findings.filter((finding) =>
    finding.message.includes("common.diagnostics.raw")
  );
  assertEquals(diagnostics, []);
});

Deno.test("shell/wording#R11: en catalog 문구는 안쪽 개념 단어를 쓰지 않는다", () => {
  const warnings = checkSource("en.ts", JSON.stringify(en), en)
    .filter((finding) => finding.severity === "warning");
  assertEquals(warnings, []);
});

Deno.test("shell/wording#R13: Baseline, Reference, Follow changes, For decisions, For summaries, Agent activity, App activity key가 있다", () => {
  assertEquals(en["contexts.view.baseline"], "Baseline");
  assertEquals(en["contexts.view.reference"], "Reference");
  assertEquals(en["contexts.view.follow-changes"], "Follow changes");
  assertEquals(en["settings.models.for-decisions"], "For decisions");
  assertEquals(en["settings.models.for-summaries"], "For summaries");
  assertEquals(en["common.activity.agent"], "Agent activity");
  assertEquals(en["common.activity.app"], "App activity");
});

Deno.test("shell/wording#R7: 저장소 화면 코드와 catalog에 문구 오류가 없다", async () => {
  const errors = errorsOf(await checkRepo(root.replace(/\/$/, "")));
  assertEquals(errors, []);
});

import { assert, assertEquals } from "@std/assert";
import {
  checkRepo,
  checkSource,
  errorsOf,
  PROBLEM_MESSAGE_KEYS,
} from "./check.ts";
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

Deno.test("shell/wording#R9: problems 문구 key는 저장소 검사의 알려진 key라 화면이 쓸 수 있고 catalog에 다시 정의하면 오류다", async () => {
  assertEquals(PROBLEM_MESSAGE_KEYS, [
    "app-detail.issue.unexpected_error",
    "app-detail.issue.reported",
    "app-detail.issue.report_incomplete",
  ]);
  const directory = await Deno.makeTempDir();
  try {
    const screens = `${directory}/apps/shell/renderer/app-frame`;
    await Deno.mkdir(screens, { recursive: true });
    await Deno.writeTextFile(
      `${screens}/issue.tsx`,
      'export const A = () => <p>{t("app-detail.issue.reported")}</p>;',
    );
    const findings = await checkRepo(directory);
    assertEquals(
      findings.filter((finding) => finding.file.endsWith("issue.tsx")),
      [],
    );
    const redefined = checkSource(
      "en.ts",
      JSON.stringify({ "app-detail.issue.reported": "Reported." }),
      { "app-detail.issue.reported": "Reported." },
      { knownKeys: PROBLEM_MESSAGE_KEYS },
    );
    assert(redefined.some((finding) => finding.rule === "owned-elsewhere"));
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("shell/wording#R7: 저장소 화면 코드와 catalog에 문구 오류가 없다", async () => {
  const errors = errorsOf(await checkRepo(root.replace(/\/$/, "")));
  assertEquals(errors, []);
});

Deno.test("shell/wording#R7: TSX generic과 속성 안 화살표 함수는 문구가 아니고 그 뒤 직접 문구는 오류다", () => {
  const clean = [
    "export function A({ go }: Props) {",
    "  const ref = useRef<HTMLButtonElement>(null);",
    "  const icons: Record<Tone, Icon> = ICONS;",
    '  return <button ref={ref} onClick={() => go(a > b)} type="button">',
    '    {t("common.button.reload")}',
    "  </button>;",
    "}",
  ].join("\n");
  assertEquals(errorsOf(checkSource("a.tsx", clean)), []);
  const literal = [
    "const ref = useRef<HTMLDivElement>(null);",
    "const a = <p onClick={() => go()}>Saved<b>now</b> later</p>;",
    "const b = <>Fragment text</>;",
  ].join("\n");
  const lines = errorsOf(checkSource("b.tsx", literal)).map((finding) =>
    finding.line
  );
  assertEquals([...new Set(lines)], [2, 3]);
});

Deno.test("shell/wording#R7: 저장소 검사는 design components를 읽고 *_test.tsx fixture는 화면 코드로 보지 않는다", async () => {
  const directory = await Deno.makeTempDir();
  try {
    const components = `${directory}/packages/design/components/button`;
    await Deno.mkdir(components, { recursive: true });
    await Deno.writeTextFile(
      `${components}/button.tsx`,
      "export const A = () => <button>Save</button>;",
    );
    await Deno.writeTextFile(
      `${components}/button_test.tsx`,
      "export const B = () => <button>Fixture</button>;",
    );
    const files = errorsOf(await checkRepo(directory)).map((finding) =>
      finding.file
    );
    assertEquals(files, ["packages/design/components/button/button.tsx"]);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("shell/wording#R7: 표현식 문자열 속 괄호와 닫은 자식 태그 뒤 부모 텍스트의 직접 문구도 오류다", () => {
  for (
    const source of [
      'const a = <button onClick={() => save("}")}>Save</button>;',
      'const b = <p><b>{t("common.button.reload")}</b> Raw text</p>;',
      'const c = <button onClick={() => save("{")}>Save</button>;',
      "const d = <button onClick={() => save('\\'}')}>Save</button>;",
      "const e = <button onClick={() => save(`${x}}`)}>Save</button>;",
      'const f = <div>{/* } */}<span title="Hi">x</span> Trailing</div>;',
    ]
  ) {
    const rules = errorsOf(checkSource("c.tsx", source)).map((finding) =>
      finding.rule
    );
    assert(
      rules.includes("literal-text") || rules.includes("literal-attribute"),
      source,
    );
  }
  const trailing = errorsOf(
    checkSource(
      "d.tsx",
      'const b = <p><b>{t("common.button.reload")}</b> Raw text</p>;',
    ),
  );
  assertEquals(trailing.map((finding) => finding.rule), ["literal-text"]);
});

Deno.test("shell/wording#R7: 문자열 괄호·template·주석·정규식·generic·화살표와 t(key)만 쓴 TSX는 오류가 없다", () => {
  const clean = [
    "// <p>Not markup</p> in a comment",
    "/* } { <b>also</b> */",
    "export function A({ go }: Props) {",
    "  const ref = useRef<HTMLButtonElement>(null);",
    "  const pattern = /[<{\"'`]/g;",
    '  const brace = "}" + "{" + `${"}"}`;',
    "  const map: Record<string, number> = {};",
    "  return (",
    '    <div onClick={() => go("}", `{${brace}}`, a > b)}>',
    "      {/* comment } */}",
    '      <button type="button" onClick={() => go("{")}>',
    '        {t("common.button.reload")}',
    "      </button>",
    '      <span>{ref.current ? t("common.button.reload") : null}</span>',
    "    </div>",
    "  );",
    "}",
  ].join("\n");
  assertEquals(errorsOf(checkSource("clean.tsx", clean)), []);
});

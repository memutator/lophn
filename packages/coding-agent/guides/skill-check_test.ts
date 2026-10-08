// 배포 skill 형식 검사 시험이다(coding-agent/guides#R2, R3). 경계값과 한 글자 초과를 비교한다.
import { assert, assertEquals, assertFalse } from "@std/assert";
import {
  checkSkill,
  SKILL_LIMITS,
  type SkillFileInput,
} from "./skill-check.ts";

type Parts = {
  name?: string;
  description?: string;
  extra?: string;
  body?: string;
};

function skillMd(parts: Parts = {}): string {
  const name = parts.name ?? "lophn-demo";
  const description = parts.description ?? "데모 절차";
  return `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n${
    parts.extra ?? ""
  }---\n${parts.body ?? "# 데모\n\n본문\n"}`;
}

function check(
  parts: Parts = {},
  directory = parts.name ?? "lophn-demo",
  more: SkillFileInput[] = [],
) {
  return checkSkill(directory, [{
    path: "SKILL.md",
    content: skillMd(parts),
  }, ...more]);
}

function rules(result: ReturnType<typeof check>): string[] {
  return result.issues.map((issue) => issue.rule);
}

Deno.test("coding-agent/guides#R2: 올바른 skill은 issue 없이 통과하고 name·description·본문을 낸다", () => {
  const result = check();
  assertEquals(result.issues, []);
  assertEquals(result.skill?.name, "lophn-demo");
  assertEquals(result.skill?.description, "데모 절차");
  assert(result.skill?.body.includes("본문"));
});

Deno.test("coding-agent/guides#R2: name은 64자까지 통과하고 65자는 거절된다", () => {
  const ok = "a".repeat(SKILL_LIMITS.nameMax);
  assertEquals(check({ name: ok }).issues, []);
  const long = "a".repeat(SKILL_LIMITS.nameMax + 1);
  assert(rules(check({ name: long })).includes("name"));
});

Deno.test("coding-agent/guides#R2: 연속·앞뒤 하이픈, 대문자, 이름과 디렉터리 불일치, 빈 name은 거절된다", () => {
  for (const name of ["a--b", "-a", "a-", "Abc", "a_b"]) {
    assert(
      rules(check({ name }, name)).includes("name"),
      `name=${JSON.stringify(name)}`,
    );
  }
  // 빈 name은 값 없는 key라 frontmatter에서 거절된다.
  assertFalse(check({ name: "" }, "x").skill !== null);
  assert(rules(check({ name: "lophn-demo" }, "lophn-other")).includes("name"));
});

Deno.test("coding-agent/guides#R2: description은 1,024자까지 통과하고 1,025자와 빈 값은 거절된다", () => {
  // 글자 수는 Unicode code point다(한글·이모지도 한 글자).
  assertEquals(
    check({ description: "가".repeat(SKILL_LIMITS.descriptionMax) }).issues,
    [],
  );
  assertEquals(
    check({ description: "😀".repeat(SKILL_LIMITS.descriptionMax) }).issues,
    [],
  );
  assert(
    rules(check({ description: "가".repeat(SKILL_LIMITS.descriptionMax + 1) }))
      .includes("description"),
  );
  assert(rules(check({ description: "" })).includes("description"));
  assert(rules(check({ description: "   " })).includes("description"));
});

Deno.test("coding-agent/guides#R2: 본문은 499줄까지 통과하고 500줄은 거절된다", () => {
  const lines = (count: number) =>
    Array.from({ length: count }, (_, i) => `줄 ${i}`).join("\n") + "\n";
  assertEquals(check({ body: lines(499) }).issues, []);
  assert(rules(check({ body: lines(500) })).includes("body"));
  // 끝 newline은 줄을 더하지 않고 CRLF도 한 줄이다.
  assertEquals(
    check({ body: lines(499).replaceAll("\n", "\r\n") }).issues,
    [],
  );
});

Deno.test("coding-agent/guides#R2: frontmatter가 없거나 닫히지 않거나 해석할 수 없으면 거절된다", () => {
  assert(
    rules(checkSkill("a", [{ path: "SKILL.md", content: "# 제목\n" }]))
      .includes("frontmatter"),
  );
  assert(
    rules(checkSkill("a", [{ path: "SKILL.md", content: "---\nname: a\n" }]))
      .includes("frontmatter"),
  );
  assert(
    rules(
      checkSkill("a", [{
        path: "SKILL.md",
        content: '---\nname: a\ndescription: "x"\n  broken: indent\n---\n',
      }]),
    ).includes("frontmatter"),
  );
  assert(rules(checkSkill("a", [])).includes("files"));
});

Deno.test("coding-agent/guides#R2: UTF-8이 아닌 파일은 거절된다", () => {
  const bytes = new Uint8Array([0x2d, 0x2d, 0x2d, 0x0a, 0xff, 0xfe]);
  const result = checkSkill("a", [{ path: "SKILL.md", content: bytes }]);
  assert(rules(result).includes("utf8"));
  assertFalse(result.skill !== null);
});

Deno.test("coding-agent/guides#R3: metadata는 문자열에서 문자열로의 map만 통과한다", () => {
  const ok = check({ extra: 'metadata:\n  owner: "lophn"\n  tier: core\n' });
  assertEquals(ok.issues, []);
  assertEquals(ok.skill?.metadata, { owner: "lophn", tier: "core" });
  for (
    const extra of [
      "metadata:\n  - a\n  - b\n",
      "metadata:\n  nested:\n    deep: x\n",
      "metadata:\n  version: 1\n",
      "metadata:\n  flag: true\n",
      "metadata: [a, b]\n",
      "metadata: plain\n",
    ]
  ) {
    assert(
      rules(check({ extra })).includes("metadata") ||
        rules(check({ extra })).includes("frontmatter"),
      extra,
    );
    assertFalse(check({ extra }).skill !== null);
  }
});

Deno.test("coding-agent/guides#R3: 제품 전용 key는 거절되고 tool 의존·권한을 숨기지 않는다", () => {
  assert(
    rules(check({ extra: 'tools: "lophn_index"\n' })).includes("frontmatter"),
  );
});

Deno.test("coding-agent/guides#R3: 본문이 직접 가리키는 한 단계 상대 참조만 통과한다", () => {
  const body = "# 데모\n\n[안내](references/guide.md)를 읽는다.\n";
  const guide = { path: "references/guide.md", content: "# 안내\n본문\n" };
  const ok = check({ body }, "lophn-demo", [guide]);
  assertEquals(ok.issues, []);
  assertEquals(ok.skill?.references, ["references/guide.md"]);
});

Deno.test("coding-agent/guides#R3: package 밖 참조·없는 파일·참조의 재참조·가리키지 않는 파일은 거절된다", () => {
  const guide = { path: "references/guide.md", content: "# 안내\n" };
  for (
    const target of ["../outside.md", "/etc/passwd", "a/../b.md", "missing.md"]
  ) {
    assert(
      rules(check({ body: `[x](${target})\n` }, "lophn-demo", [guide]))
        .includes("reference"),
      target,
    );
  }
  // 참조의 재참조다.
  const chained = {
    path: "references/guide.md",
    content: "[다음](references/other.md)\n",
  };
  const other = { path: "references/other.md", content: "끝\n" };
  const result = check(
    { body: "[x](references/guide.md)\n[y](references/other.md)\n" },
    "lophn-demo",
    [chained, other],
  );
  assert(result.issues.some((issue) => issue.path === "references/guide.md"));
  // 본문이 가리키지 않는 파일은 숨은 자료라 거절이다.
  assert(
    rules(check({ body: "참조 없음\n" }, "lophn-demo", [guide]))
      .includes("reference"),
  );
  // URL과 anchor, code 안의 링크는 파일 참조가 아니다.
  assertEquals(
    check({
      body: "[a](https://example.com) [b](#절) `[c](x.md)`\n",
    }).issues,
    [],
  );
});

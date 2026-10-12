import { assertEquals } from "@std/assert";
import {
  DEPLOY_SKILL_NAMES,
  HOOK_CORE_WAIT_MS,
  HOOK_EMPTY_EXIT,
  HOOK_EMPTY_STDOUT,
  HOOK_MAX_CODE_POINTS,
  HOOK_MAX_LINES,
  HOOK_MAX_PROBLEMS,
  HOOK_TOTAL_TIMEOUT_MS,
  skillBodySchema,
  skillDescriptionSchema,
  skillMetadataSchema,
  skillNameSchema,
} from "./guides.ts";

const at = (limit: number) => "a".repeat(limit);

Deno.test(
  "coding-agent/guides#R1, coding-agent/guides#R2: 배포 skill 이름 네 개를 공개한다",
  () => {
    assertEquals(DEPLOY_SKILL_NAMES, [
      "lophn-navigate",
      "lophn-save",
      "lophn-build-app",
      "lophn-repair",
    ]);
    for (const name of DEPLOY_SKILL_NAMES) {
      assertEquals(skillNameSchema.parse(name), name);
    }
  },
);

Deno.test(
  "coding-agent/guides#R2: skill 이름은 소문자 영문·숫자·단일 하이픈 1~64자다",
  () => {
    assertEquals(skillNameSchema.parse("a"), "a");
    assertEquals(skillNameSchema.parse(at(64)), at(64));
    // 한 글자 초과, 대문자, 연속·끝 하이픈, 빈 이름, 숫자 외 문자는 거절이다.
    assertEquals(skillNameSchema.safeParse(at(65)).success, false);
    assertEquals(skillNameSchema.safeParse("Lophn").success, false);
    assertEquals(skillNameSchema.safeParse("a--b").success, false);
    assertEquals(skillNameSchema.safeParse("-a").success, false);
    assertEquals(skillNameSchema.safeParse("a-").success, false);
    assertEquals(skillNameSchema.safeParse("").success, false);
    assertEquals(skillNameSchema.safeParse("a b").success, false);
    assertEquals(skillNameSchema.safeParse("a_b").success, false);
    assertEquals(skillNameSchema.safeParse("a1").success, true);
    assertEquals(skillNameSchema.safeParse("1a").success, true);
  },
);

Deno.test(
  "coding-agent/guides#R2: 설명은 공백뿐인 문자열 없이 1~1,024 code point다",
  () => {
    assertEquals(skillDescriptionSchema.parse("설명"), "설명");
    // code point 기준 1,024자(amh 문자는 surrogate pair)다.
    const surrogate = "\u{10348}".repeat(1_024);
    assertEquals(skillDescriptionSchema.parse(surrogate), surrogate);
    // code point 1,024의 UTF-16 length는 2,048이지만 code point로 세면 통과다.
    assertEquals([...surrogate].length, 1_024);
    assertEquals(skillNameSchema.safeParse(at(64)).success, true);
    assertEquals(
      skillDescriptionSchema.safeParse("\u{10348}".repeat(1_025)).success,
      false,
    );
    assertEquals(skillDescriptionSchema.safeParse("").success, false);
    assertEquals(skillDescriptionSchema.safeParse("   ").success, false);
  },
);

Deno.test(
  "coding-agent/guides#R2: 본문은 빈 본문 없이 500 logical line 미만이다",
  () => {
    assertEquals(skillBodySchema.parse("한 줄"), "한 줄");
    const last = Array.from({ length: 499 }, (_, index) => `line ${index}`)
      .join("\n");
    assertEquals(skillBodySchema.parse(last), last);
    const full = Array.from({ length: 500 }, (_, index) => `line ${index}`)
      .join("\n");
    assertEquals(skillBodySchema.safeParse(full).success, false);
    assertEquals(skillBodySchema.safeParse("").success, false);
    // CRLF를 LF로 정규화한 logical line으로 센다.
    const crlf = Array.from({ length: 500 }, (_, index) => `line ${index}`)
      .join("\r\n");
    assertEquals(skillBodySchema.safeParse(crlf).success, false);
  },
);

Deno.test(
  "coding-agent/guides#R3: skill metadata는 문자열→문자열 map이며 null이다",
  () => {
    assertEquals(skillMetadataSchema.parse(null), null);
    assertEquals(skillMetadataSchema.parse({ key: "value" }), {
      key: "value",
    });
    // 배열 값, 중첩 map, 비문자열 값은 거절이다.
    assertEquals(skillMetadataSchema.safeParse({ key: ["a"] }).success, false);
    assertEquals(
      skillMetadataSchema.safeParse({ key: { nested: "a" } }).success,
      false,
    );
    assertEquals(skillMetadataSchema.safeParse({ key: 1 }).success, false);
  },
);

Deno.test(
  "coding-agent/guides#R23: hook 출력 상한은 10줄·1,200 code point·문제 3개다",
  () => {
    assertEquals(HOOK_MAX_LINES, 10);
    assertEquals(HOOK_MAX_CODE_POINTS, 1_200);
    assertEquals(HOOK_MAX_PROBLEMS, 3);
  },
);

Deno.test(
  "coding-agent/guides#R24: hook timeout은 전체 5초·daemon 대기 3초고 장애·빈 결과는 빈 stdout·exit 0이다",
  () => {
    assertEquals(HOOK_TOTAL_TIMEOUT_MS, 5_000);
    assertEquals(HOOK_CORE_WAIT_MS, 3_000);
    assertEquals(HOOK_EMPTY_STDOUT, "");
    assertEquals(HOOK_EMPTY_EXIT, 0);
  },
);

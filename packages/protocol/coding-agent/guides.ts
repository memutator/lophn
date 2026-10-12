import { z } from "zod";

// 배포 skill 이름 네 개다(guides 도메인 모델의 불변 조건). 추후 skill 수를
// entity 제약으로 고정하지 않는다.
export const DEPLOY_SKILL_NAMES = [
  "lophn-navigate",
  "lophn-save",
  "lophn-build-app",
  "lophn-repair",
] as const;

export type DeploySkillName = (typeof DEPLOY_SKILL_NAMES)[number];

// CodingAgentSkill 값 제약(guides 도메인 모델). 문자 상한은 Unicode code point,
// 줄 상한은 CRLF를 LF로 정규화한 logical line으로 센다.
/** 배포 skill 이름이다. 소문자 영문·숫자·단일 하이픈 1~64자이며 배포 디렉터리 이름과 같다. */
export const skillNameSchema = z.string().refine(
  (value) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(value),
  {
    message: "skill name must be lowercase letters, digits and single hyphens",
  },
).refine((value) => value.length >= 1 && value.length <= 64, {
  message: "skill name must be 1-64 characters",
});

/** 배포 skill 설명이다. 공백뿐인 문자열 없이 1~1,024 code point다. */
export const skillDescriptionSchema = z.string().refine(
  (value) => {
    const count = [...value].length;
    return count >= 1 && count <= 1_024 && value.trim() !== "";
  },
  { message: "skill description must be 1-1024 code points and not blank" },
);

/** 배포 skill 본문이다. 빈 본문 없이 500 logical line 미만이다. */
export const skillBodySchema = z.string().refine(
  (value) => {
    const lines = value.replace(/\r\n/g, "\n").split("\n").length;
    return value.trim() !== "" && lines < 500;
  },
  { message: "skill body must be non-empty and under 500 logical lines" },
);

/** 배포 skill 부가 metadata다. 문자열에서 문자열로의 map만 허용한다. */
export const skillMetadataSchema = z.record(z.string(), z.string()).nullable();

// session 시작 hook 출력 상한(architecture 5.5). warning 이상
// coding_agent 대상 open/fixed 문제 최대 3개와 ticket 요약을 이 안에 넣는다.
/** hook 출력 최대 줄 수다. */
export const HOOK_MAX_LINES = 10;
/** hook 출력 최대 문자 수다. Unicode code point로 센다. */
export const HOOK_MAX_CODE_POINTS = 1_200;
/** hook에 넣는 문제 최대 개수다. 나머지는 수와 상세 읽기 안내로 준다. */
export const HOOK_MAX_PROBLEMS = 3;
/** hook 전체 timeout이다. */
export const HOOK_TOTAL_TIMEOUT_MS = 5_000;
/** hook이 daemon을 기다리는 시간이다. */
export const HOOK_CORE_WAIT_MS = 3_000;

// 장애·빈 결과는 stdout 빈 값과 exit 0이다(hook이 세션 시작을 막지 않는다).
export const HOOK_EMPTY_STDOUT = "";
export const HOOK_EMPTY_EXIT = 0;

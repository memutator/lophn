import { z } from "zod";
import { defineSetting } from "../platform/mod.ts";

// skill 발견 root 정의 등록(contracts#T24 settings registry, lophn-agent#T35).
// 사람이 등록한 절대 폴더를 등록 순서대로 발견한다(extensions R1). machine_local
// 이고 다음 run부터 적용한다(R8). 기본은 등록 폴더가 없는 빈 목록이다(R10).
// runtime이 같은 값 타입으로 읽도록 core 등록과 한 정의다.
export const skillFoldersSetting = defineSetting({
  key: "lophn-agent.extensions.skill_folders",
  owner: "lophn-agent/extensions",
  display_name_key: "settings.lophn-agent.skill_folders.name",
  description: "Registered absolute skill discovery roots in user order.",
  value_meaning_key: "settings.lophn-agent.skill_folders.value",
  default_meaning_key: "settings.lophn-agent.skill_folders.default",
  affected_features: ["lophn-agent/extensions"],
  risk_key: "settings.lophn-agent.skill_folders.risk",
  revert_key: "settings.lophn-agent.skill_folders.revert",
  constraints: {
    path: "absolute folder paths",
    max_entries: 64,
  },
  required: false,
  layers: ["common"],
  apply_at: "next_run",
  apply_at_key: "settings.lophn-agent.skill_folders.apply_at",
  machine_local: true,
  default_present: true,
  default: [],
  value_type: z.array(z.string().regex(/^(\/|[A-Za-z]:\\).+/)).max(64),
});

// skill의 출처다(extensions domain model SkillEntry.source_kind). 발견 순서 그대로다: 자리 층의 place가 먼저고
// 나머지 셋은 전역 층이다(R1, R32).
export const SKILL_SOURCE_KINDS = [
  "place",
  "registered",
  "personal",
  "bundled",
] as const;
export const skillSourceKindSchema = z.enum(SKILL_SOURCE_KINDS);
export type SkillSourceKind = z.infer<typeof skillSourceKindSchema>;

// 화면이 보이는 발견 목록의 한 줄이다. 본문·보조 자료·bundle 경로는 싣지 않는다(R5).
export const skillSummarySchema = z.object({
  name: z.string().min(1).max(64),
  description: z.string().min(1).max(1024),
  source_kind: skillSourceKindSchema,
});
export type SkillSummary = z.infer<typeof skillSummarySchema>;

// 같은 이름으로 가려진 skill이다. 먼저 발견한 출처가 이기고 진 출처를 사람에게 알린다(R3, R33).
export const skillShadowSchema = z.object({
  name: z.string().min(1).max(64),
  kept: skillSourceKindSchema,
  hidden: skillSourceKindSchema,
});
export type SkillShadow = z.infer<typeof skillShadowSchema>;

// 형식이 맞지 않아 목록에서 제외한 꾸러미의 경로와 이유다(R2).
export const skillSkippedSchema = z.object({
  path: z.string().min(1),
  reason: z.string().min(1),
});
export type SkillSkipped = z.infer<typeof skillSkippedSchema>;

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

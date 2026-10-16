// 전역 층의 설정 선언. 값은 `<data root>/settings.json`에 있고 사람이 Settings › Agents에서 고른다.
import { z } from "zod";
import { declareSetting } from "../../../protocol/config/mod.ts";
import { mcpServerSchema } from "../../../protocol/lophn-agent/mcp-settings.ts";
import {
  skillNameSchema,
  SKILLS_OFF_MAX,
} from "../../../protocol/lophn-agent/skill-settings.ts";

// 사람이 등록한 skill 발견 폴더. 등록 순서대로 발견한다.
export const skillFoldersSetting = declareSetting({
  key: "lophn-agent.extensions.skill_folders",
  type: z.array(z.string().regex(/^(\/|[A-Za-z]:\\).+/)).max(64),
  default: [],
});

// 모든 agent에서 끈 skill의 정확한 이름. 지금 발견되지 않는 이름도 그대로 둔다.
export const skillsOffSetting = declareSetting({
  key: "lophn-agent.extensions.skills_off",
  type: z.array(skillNameSchema).max(SKILLS_OFF_MAX),
  default: [],
});

// 전역 MCP server 목록. project·agent 층과 같은 mcpServerSchema 배열이다.
export const globalMcpServersSetting = declareSetting({
  key: "lophn-agent.extensions.mcp_servers",
  type: z.array(mcpServerSchema).max(32),
  default: [],
});

export const extensionSettings = [
  skillFoldersSetting,
  skillsOffSetting,
  globalMcpServersSetting,
] as const;

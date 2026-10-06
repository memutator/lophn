// `lophn session summary|plan` command 표다(cli#R40). summary는 `lophn_session`의 결과를 같은 read route로
// 읽고 plan은 sessions의 LaunchPlan 입출력이다. 두 backing(core의 session summary route, sessions의
// plan)이 아직 없으면 실행은 성공으로 꾸미지 않고 unavailable이다(dispatch).
import {
  cliSessionPlanSchema,
  cliSessionSummarySchema,
} from "../../../contracts/coding-agent/mod.ts";
import type { CommandEntry } from "./types.ts";

export const SESSION_COMMANDS: readonly CommandEntry[] = [
  { name: "session summary", input: cliSessionSummarySchema },
  { name: "session plan", input: cliSessionPlanSchema },
];

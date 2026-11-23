// lophn이 내놓는 명령 전체의 표다. binary(`../main.ts`)와 core의 `lophn` tool이 같은 이 목록을 쓴다.
// 명령을 더하려면 명령 file에서 `defineCommand`로 만들고 아래 COMMANDS에 올린다.
import type { WorkspaceKind } from "../../protocol/lophn-agent/workspaces.ts";
import { AGENT_COMMANDS } from "./agent.ts";
import { APP_COMMANDS } from "./app.ts";
import { APP_SHARE_COMMANDS } from "./app-share.ts";
import { ARTIFACT_COMMANDS } from "./artifact.ts";
import { ASK_COMMANDS } from "./ask.ts";
import { BROWSER_COMMANDS } from "./browser.ts";
import { CALL_COMMANDS } from "./call.ts";
import { FOLLOW_UP_COMMANDS } from "./follow-up.ts";
import { HANDOFF_COMMANDS } from "./handoff.ts";
import { IMPACT_COMMANDS } from "./impact.ts";
import { JOB_COMMANDS } from "./job.ts";
import { LOGIN_COMMANDS } from "./login.ts";
import { MACHINE_COMMANDS } from "./machine.ts";
import { PACKAGE_COMMANDS } from "./package.ts";
import { PREVIEW_COMMANDS } from "./preview.ts";
import { PROJECT_COMMANDS } from "./project.ts";
import { RELEASE_COMMANDS } from "./release.ts";
import { REMOTE_COMMANDS } from "./remote.ts";
import { RUN_COMMANDS } from "./run.ts";
import { SESSION_COMMANDS } from "./session.ts";
import { SETTINGS_COMMANDS } from "./settings.ts";
import { TAB_COMMANDS } from "./tab.ts";
import { TEAM_COMMANDS } from "./team.ts";
import type { Command } from "./types.ts";
import { UPDATE_COMMANDS } from "./update.ts";
import { WORKFLOW_COMMANDS } from "./workflow.ts";

export type {
  Command,
  CommandContext,
  CommandCore,
  CommandDoc,
  CommandEffect,
  CommandResult,
} from "./types.ts";
export { defineCommand } from "./types.ts";

export const COMMANDS: readonly Command[] = [
  ...CALL_COMMANDS,
  ...AGENT_COMMANDS,
  ...ARTIFACT_COMMANDS,
  ...FOLLOW_UP_COMMANDS,
  ...HANDOFF_COMMANDS,
  ...IMPACT_COMMANDS,
  ...JOB_COMMANDS,
  ...LOGIN_COMMANDS,
  ...MACHINE_COMMANDS,
  ...ASK_COMMANDS,
  ...APP_COMMANDS,
  ...APP_SHARE_COMMANDS,
  ...BROWSER_COMMANDS,
  ...PACKAGE_COMMANDS,
  ...PREVIEW_COMMANDS,
  ...PROJECT_COMMANDS,
  ...RELEASE_COMMANDS,
  ...REMOTE_COMMANDS,
  ...RUN_COMMANDS,
  ...SESSION_COMMANDS,
  ...SETTINGS_COMMANDS,
  ...TAB_COMMANDS,
  ...TEAM_COMMANDS,
  ...UPDATE_COMMANDS,
  ...WORKFLOW_COMMANDS,
];

// 그 workspace 종류의 lophn agent가 부를 수 있는 명령이다. 이름순이라 같은 workspace 종류면 같은 bytes다.
export function commandsForWorkspace(kind: WorkspaceKind): readonly Command[] {
  return COMMANDS.filter((command) =>
    command.workspaces.includes(kind),
  ).toSorted((a, b) => a.name.localeCompare(b.name));
}

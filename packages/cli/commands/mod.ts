// lophn이 내놓는 명령 전체의 표다. binary(`../main.ts`)와 core의 `lophn` tool이 같은 이 목록을 쓴다.
// 명령을 더하려면 명령 file에서 `defineCommand`로 만들고 아래 COMMANDS에 올린다.
import type { PlaceKind } from "../../protocol/lophn-agent/places.ts";
import { AGENT_COMMANDS } from "./agent.ts";
import { APP_COMMANDS } from "./app.ts";
import { CALL_COMMANDS } from "./call.ts";
import { DOMAIN_COMMANDS } from "./domain.ts";
import { JOB_COMMANDS } from "./job.ts";
import { KIND_COMMANDS } from "./kind.ts";
import { PACKAGE_COMMANDS } from "./package.ts";
import { PREVIEW_COMMANDS } from "./preview.ts";
import { RELEASE_COMMANDS } from "./release.ts";
import { RUN_COMMANDS } from "./run.ts";
import { SESSION_COMMANDS } from "./session.ts";
import { SETTINGS_COMMANDS } from "./settings.ts";
import type { Command } from "./types.ts";
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
  ...DOMAIN_COMMANDS,
  ...JOB_COMMANDS,
  ...KIND_COMMANDS,
  ...APP_COMMANDS,
  ...PACKAGE_COMMANDS,
  ...PREVIEW_COMMANDS,
  ...RELEASE_COMMANDS,
  ...RUN_COMMANDS,
  ...SESSION_COMMANDS,
  ...SETTINGS_COMMANDS,
  ...WORKFLOW_COMMANDS,
];

// 그 place 종류의 lophn agent가 부를 수 있는 명령이다. 이름순이라 같은 place 종류면 같은 bytes다.
export function commandsForPlace(kind: PlaceKind): readonly Command[] {
  return COMMANDS.filter((command) => command.places.includes(kind)).toSorted(
    (a, b) => a.name.localeCompare(b.name),
  );
}

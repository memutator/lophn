// lophn이 내놓는 명령 전체의 표다. binary(`../main.ts`)와 core의 `lophn` tool이 같은 이 목록을 쓴다.
// 명령을 더하려면 명령 file에서 `defineCommand`로 만들고 아래 COMMANDS에 올린다.
import type { PlaceKind } from "../../protocol/lophn-agent/places.ts";
import { JOB_COMMANDS } from "./job.ts";
import { RUN_COMMANDS } from "./run.ts";
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
  ...JOB_COMMANDS,
  ...RUN_COMMANDS,
  ...WORKFLOW_COMMANDS,
];

// 그 place 종류의 lophn agent가 부를 수 있는 명령이다. 이름순이라 같은 place 종류면 같은 bytes다.
export function commandsForPlace(kind: PlaceKind): readonly Command[] {
  return COMMANDS.filter((command) => command.places.includes(kind)).toSorted(
    (a, b) => a.name.localeCompare(b.name),
  );
}

// Reactions의 순수 규칙: event 줄의 글과 선택지. 기본은 열고 묻지 않음이다.
import type { MessageKey } from "@lophn/wording";

import type { ReactionEvent, ReactionMode, ReactionModes } from "./source.ts";

const DEFAULT_MODE: ReactionMode = "open";

interface ReactionRow {
  readonly event: ReactionEvent;
  readonly name: MessageKey;
  /** 언제. */
  readonly when: MessageKey;
  /** 열리는 session. */
  readonly opens: MessageKey;
}

export const REACTION_ROWS: readonly ReactionRow[] = [
  {
    event: "ProblemOpened",
    name: "settings.label.reaction-problem-opened",
    when: "settings.reaction.problem-opened-when",
    opens: "settings.reaction.opens-project-manager",
  },
  {
    event: "ProblemReopened",
    name: "settings.label.reaction-problem-reopened",
    when: "settings.reaction.problem-reopened-when",
    opens: "settings.reaction.opens-project-manager",
  },
  {
    event: "AppRestartHalted",
    name: "settings.label.reaction-restart-halted",
    when: "settings.reaction.restart-halted-when",
    opens: "settings.reaction.opens-project-manager",
  },
  {
    event: "ReleaseActivationFailed",
    name: "settings.label.reaction-activation-failed",
    when: "settings.reaction.activation-failed-when",
    opens: "settings.reaction.opens-project-manager",
  },
  {
    event: "KindViolationFound",
    name: "settings.label.reaction-kind-violation",
    when: "settings.reaction.kind-violation-when",
    opens: "settings.reaction.opens-project-manager",
  },
  {
    event: "PublicToolsChanged",
    name: "settings.label.reaction-public-tools-changed",
    when: "settings.reaction.public-tools-changed-when",
    opens: "settings.reaction.opens-project-manager",
  },
];

export const MODE_OPTIONS: readonly {
  readonly value: ReactionMode;
  readonly label: MessageKey;
}[] = [
  { value: "off", label: "settings.label.reaction-off" },
  { value: "open", label: "settings.label.reaction-open" },
  { value: "ask", label: "settings.label.reaction-ask" },
];

export function modeOf(stored: unknown): ReactionMode {
  return MODE_OPTIONS.some((option) => option.value === stored)
    ? stored as ReactionMode
    : DEFAULT_MODE;
}

/** 설정 key. `ProblemOpened` → `reactions.problem_opened`. */
export function settingKeyOf(event: ReactionEvent): string {
  return `reactions.${
    event.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase()
  }`;
}

export const DEFAULT_MODES: ReactionModes = {
  ProblemOpened: DEFAULT_MODE,
  ProblemReopened: DEFAULT_MODE,
  AppRestartHalted: DEFAULT_MODE,
  ReleaseActivationFailed: DEFAULT_MODE,
  KindViolationFound: DEFAULT_MODE,
  PublicToolsChanged: DEFAULT_MODE,
};

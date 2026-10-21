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
    event: "ReleaseActivationFailed",
    name: "settings.label.reaction-activation-failed",
    when: "settings.reaction.activation-failed-when",
    opens: "settings.reaction.opens-app-engineer",
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

/** 설정 key. `ReleaseActivationFailed` → `reactions.release_activation_failed`. */
export function settingKeyOf(event: ReactionEvent): string {
  return `reactions.${
    event.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase()
  }`;
}

export const DEFAULT_MODES: ReactionModes = {
  ReleaseActivationFailed: DEFAULT_MODE,
};

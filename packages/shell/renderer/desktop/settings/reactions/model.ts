// Reactions의 순수 규칙: event 줄의 글. 기본은 켬이다.
import type { MessageKey } from "@lophn/wording";

import type { ReactionEvent, ReactionMode, ReactionModes } from "./source.ts";

const DEFAULT_MODE: ReactionMode = "on";

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

export function modeOf(stored: unknown): ReactionMode {
  return stored === "off" ? "off" : "on";
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

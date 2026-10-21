import { z } from "zod";

// 새 일을 여는 domain event. 맡긴 call을 닫는 셋은 끌 수 없어서 여기 없다.
export const REACTION_EVENT_TYPES = ["ReleaseActivationFailed"] as const;
export const reactionEventTypeSchema = z.enum(REACTION_EVENT_TYPES);
export type ReactionEventType = z.infer<typeof reactionEventTypeSchema>;

// 끔, 켬.
export const REACTION_MODES = ["off", "on"] as const;
export const reactionModeSchema = z.enum(REACTION_MODES);
type ReactionMode = z.infer<typeof reactionModeSchema>;
export const DEFAULT_REACTION_MODE: ReactionMode = "on";

// Settings key는 `reactions.<snake_case 이벤트 이름>`이다.
export function reactionSettingKey(type: ReactionEventType): string {
  return `reactions.${
    type.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase()
  }`;
}

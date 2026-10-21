import {
  DEFAULT_REACTION_MODE,
  REACTION_EVENT_TYPES,
  type ReactionEventType,
  reactionModeSchema,
  reactionSettingKey,
} from "../../../protocol/approvals/mod.ts";
import {
  declareSetting,
  type SettingDeclaration,
} from "../../../protocol/config/mod.ts";

// Settings › Agents 화면용 선언. 이름과 설명 wording key는 settingWordingKey가 key에서 만든다.
export const reactionSettings = Object.fromEntries(
  REACTION_EVENT_TYPES.map((type) => [
    type,
    declareSetting({
      key: reactionSettingKey(type),
      type: reactionModeSchema,
      default: DEFAULT_REACTION_MODE,
    }),
  ]),
) as Record<
  ReactionEventType,
  SettingDeclaration<typeof reactionModeSchema>
>;

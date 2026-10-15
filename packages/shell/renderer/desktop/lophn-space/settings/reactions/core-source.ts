// ReactionsSource를 선언 설정(`reactions.<event>`)의 읽기·쓰기로 만든다.
import type { CoreSource } from "../../../connection/connection.ts";
import { chooseSetting, readEffective } from "../declared.ts";
import { DEFAULT_MODES, modeOf, settingKeyOf } from "./model.ts";
import {
  REACTION_EVENTS,
  type ReactionModes,
  type ReactionsSource,
} from "./source.ts";

export function coreReactionsSource(core: CoreSource): ReactionsSource {
  return {
    watch: (listener) => core.subscribe(listener),

    async modes() {
      const read = await readEffective(core, REACTION_EVENTS.map(settingKeyOf));
      if (!read.ok) return read;
      const modes: Record<string, string> = { ...DEFAULT_MODES };
      for (const event of REACTION_EVENTS) {
        modes[event] = modeOf(read.value.get(settingKeyOf(event)));
      }
      return { ok: true, value: modes as ReactionModes };
    },

    choose: (event, mode) => chooseSetting(core, settingKeyOf(event), mode),
  };
}

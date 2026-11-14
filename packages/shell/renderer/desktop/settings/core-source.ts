// SettingsSource를 main의 core 통로로 만든다(선언한 일반 설정 쓰기). 응답은 main의 contract client가 route
// output schema로 이미 검사했다. provider와 agent 기본값, 도구 server는 각자의 통로(providers/core-source,
// agents/core-source)가 맡는다.
import type { CoreSource } from "../connection/connection.ts";
import { updateSettings } from "./declared.ts";
import type { SettingsSource } from "./source.ts";

export function coreSettingsSource(core: CoreSource): SettingsSource {
  return {
    update: (changes) => updateSettings(core, changes),
  };
}

// platform이 만드는 settings registry 출처. 여러 팀이 같은 route(/v1/settings/*)에
// 붙는 곳이라 registry는 platform 팀(code-map 의존 규칙)이 만든다. 각 팀은 자기
// 등록 파일의 setting 항목만 고친다: coding-agent는 coding-agent.ts의 harness
// 설정 3개다(platform/settings#R31). route는 contract ROUTES가 이미 고정하므로
// 여기서 route를 다시 등록하지 않는다. 설정값은 사람이 명시 apply한 선택과 ledger
// 기록만 바꾼다.
import {
  createSettingsCommands,
  SettingRegistry,
  SETTINGS_SCHEMA_STEPS,
  settingsDefinitionsRead,
  settingsGetRead,
  settingsHistoryRead,
} from "../../packages/platform/settings/mod.ts";
import type {
  SchemaStep,
  SettingDefinition,
} from "../../packages/contracts/platform/mod.ts";
import type { ReaderRegistration } from "../../packages/platform/ledger/mod.ts";
import { harnessSettings } from "./coding-agent.ts";
import { readingWidthSetting } from "./shell.ts";

export type SettingsRegistration = {
  schemaSteps: readonly SchemaStep[];
  commands: unknown[];
  reads: ReaderRegistration["reads"];
};

// core 조립이 모은 setting 항목 전부다. assemble()이 팀 등록 파일의 settings 키를
// 모으고, 여기서 registry 하나를 만든다. writer worker와 reader worker가 이 모듈을
// 다시 import하고, apply·reload command와 settings read handler를 등록한다.
export function createSettingsRegistration(
  settings: readonly SettingDefinition[],
): SettingsRegistration {
  const registry = new SettingRegistry(settings);
  const commands = createSettingsCommands(registry);
  return {
    schemaSteps: SETTINGS_SCHEMA_STEPS,
    commands: [commands.apply, commands.reload] as unknown[],
    reads: [
      settingsDefinitionsRead(registry),
      settingsGetRead(registry),
      settingsHistoryRead(registry),
    ],
  };
}

// 제품 기동이 쓰는 registry다. 항목은 각 팀 등록 파일이 공개한 것 전부다.
// writer worker와 reader worker가 이 모듈을 다시 import하고, 같은 registry로
// apply·reload command와 settings read handler를 등록한다.
export const settingsDefinitions = createSettingsRegistration([
  readingWidthSetting,
  ...harnessSettings,
]);

// reader Worker가 이 모듈에서 settings read handler를 다시 조립한다.
export function createReaderRegistration(): ReaderRegistration {
  return {
    reads: [...settingsDefinitions.reads],
    ports: new Map(),
  };
}

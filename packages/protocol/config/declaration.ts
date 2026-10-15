import type { z } from "zod";

// 첫 구간이 선언한 요소 이름(owner)이다. 예: "shell.reading_width", "agents.run_turn_limit"
export const SETTING_KEY = /^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*)+$/;

export interface SettingDeclaration<S extends z.ZodType = z.ZodType> {
  readonly key: string;
  readonly type: S;
  /** 없으면 사람이 골라야 하는 필수 설정이다. 비어 있으면 그 설정을 쓰는 기능만 시작하지 않는다. */
  readonly default?: z.input<S>;
}

export function declareSetting<S extends z.ZodType>(
  d: SettingDeclaration<S>,
): SettingDeclaration<S> {
  if (!SETTING_KEY.test(d.key)) {
    throw new Error(`setting key is not valid: ${d.key}`);
  }
  if (d.default !== undefined) d.type.parse(d.default);
  return d;
}

export interface SettingsReader {
  /** 기본값이 있으면 값이다. 기본값이 없고 사람이 고르지 않았으면 undefined다. */
  get<S extends z.ZodType>(
    setting: SettingDeclaration<S>,
  ): z.output<S> | undefined;
}

/** 화면 이름과 설명의 wording key. 예: settings.shell-reading_width.name */
export function settingWordingKey(
  key: string,
  part: "name" | "help",
): string {
  return `settings.${key.replaceAll(".", "-")}.${part}`;
}

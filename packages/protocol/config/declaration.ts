import type { z } from "zod";

// 첫 구간이 선언한 요소 이름(owner)이다. 예: "shell.reading_width", "agents.run_turn_limit"
export const SETTING_KEY = /^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*)+$/;
// folder 설정의 항목 id. file 이름(`<id>.json`)이고 key의 마지막 구간(`<folder key>.<id>`)이다.
export const SETTING_ENTRY_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
// 항목 file 하나의 상한. 넘는 file은 읽지 않고 쓰지 않는다.
export const SETTING_ENTRY_MAX_BYTES = 256 * 1024;

/** 뜻 검사의 결과 한 줄. reject면 값을 쓰지 않고, note면 쓰고 바꾼 쪽에 알린다. */
export interface SettingIssue {
  readonly level: "reject" | "note";
  readonly message: string;
}

export interface SettingsReader {
  /** 기본값이 있으면 값이다. 기본값이 없고 사람이 고르지 않았으면 undefined다. */
  get<S extends z.ZodType>(
    setting: SettingDeclaration<S>,
  ): z.output<S> | undefined;
}

/** 뜻 검사가 보는 값. 이번 변경을 모두 적용한 뒤의 모습이다. */
export interface SettingsView extends SettingsReader {
  /** folder 설정의 항목(id → 값). */
  entries(folder: SettingFolderDeclaration): Readonly<Record<string, unknown>>;
}

interface Declared<S extends z.ZodType> {
  readonly key: string;
  readonly type: S;
  /** 영어 한두 문장. `lophn settings get`이 보이고 agent가 이것으로 설정을 찾는다. */
  readonly description: string;
  /**
   * true면 사람이 Settings 화면에서만 바꾼다. `lophn settings set`과 agent는 바꾸지 못한다.
   * agent가 할 수 있는 일의 범위를 정하는 설정(승인 규칙, call 정책, MCP server 등)에 단다.
   */
  readonly locked?: true;
}

export interface SettingDeclaration<S extends z.ZodType = z.ZodType>
  extends Declared<S> {
  /** 없으면 사람이 골라야 하는 필수 설정이다. 비어 있으면 그 설정을 쓰는 기능만 시작하지 않는다. */
  readonly default?: z.input<S>;
  /** type을 통과한 값의 뜻 검사. 바꿀 때만 돈다(file을 읽을 때는 type만 본다). */
  readonly check?: (
    value: z.output<S>,
    view: SettingsView,
  ) => readonly SettingIssue[];
}

/**
 * 항목마다 file 하나로 저장되는 설정 묶음. 항목의 key는 `<key>.<id>`이고 file은
 * `<data root>/<folder>/<id>.json`이다. 사람이 그 folder에 file을 직접 두어도 같은 항목이 된다.
 */
export interface SettingFolderDeclaration<S extends z.ZodType = z.ZodType>
  extends Declared<S> {
  readonly folder: string;
  readonly check?: (
    value: z.output<S>,
    view: SettingsView,
    id: string,
  ) => readonly SettingIssue[];
}

function checkDeclared(d: Declared<z.ZodType>): void {
  if (!SETTING_KEY.test(d.key)) {
    throw new Error(`setting key is not valid: ${d.key}`);
  }
  if (d.description.trim() === "") {
    throw new Error(`setting has no description: ${d.key}`);
  }
}

export function declareSetting<S extends z.ZodType>(
  d: SettingDeclaration<S>,
): SettingDeclaration<S> {
  checkDeclared(d);
  if (d.default !== undefined) d.type.parse(d.default);
  return d;
}

export function declareSettingFolder<S extends z.ZodType>(
  d: SettingFolderDeclaration<S>,
): SettingFolderDeclaration<S> {
  checkDeclared(d);
  if (!SETTING_ENTRY_ID.test(d.folder)) {
    throw new Error(`setting folder name is not valid: ${d.folder}`);
  }
  return d;
}

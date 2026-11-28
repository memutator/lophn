// General의 순수 규칙. 선언한 설정의 JSON Schema에서 입력 종류를 정하고, 이름·설명은 설정 key로
// 정한 message key에서 읽는다. 모르는 type은 바꿀 수 없는 값으로만 보인다.
import { en, type MessageKey, t } from "@lophn/i18n";

import {
  DEFAULT_MODE_SETTING_KEY,
  LOCAL_TOOL_TRUST_SETTING_KEY,
  PERMISSION_RULES_SETTING_KEY,
  WORKFLOW_MODES_SETTING_KEY,
} from "../../../../../protocol/approvals/permission-rules.ts";
import { CODING_DEPLOYED_SKILLS_SETTING_KEY } from "../../../../../protocol/lophn-agent/skill-settings.ts";
import { slugText, valueText } from "../model.ts";
import type { SettingEntry, SettingRejectReason } from "../source.ts";

export type Control =
  | { readonly kind: "boolean" }
  | {
      readonly kind: "range";
      readonly min: number | null;
      readonly max: number | null;
      readonly integer: boolean;
    }
  | { readonly kind: "choice"; readonly options: readonly string[] }
  | { readonly kind: "list" }
  /** 글 하나(경로 같은 것). 틀린 값은 core가 rejected로 돌려준다. */
  | { readonly kind: "text" }
  | { readonly kind: "fixed" };

type Schema = Readonly<Record<string, unknown>>;

// zod가 정수 type에 붙이는 안전 정수 한계는 사람이 정한 범위가 아니다.
function bound(value: unknown): number | null {
  return typeof value === "number" && Math.abs(value) < Number.MAX_SAFE_INTEGER
    ? value
    : null;
}

function constsOf(schemas: unknown): readonly string[] | null {
  if (!Array.isArray(schemas)) return null;
  const values = schemas.map((schema) => (schema as Schema | null)?.const);
  return values.every((value) => typeof value === "string")
    ? (values as string[])
    : null;
}

export function controlOf(type: Schema): Control {
  if (type.type === "boolean") return { kind: "boolean" };
  if (type.type === "integer" || type.type === "number") {
    return {
      kind: "range",
      min: bound(type.minimum),
      max: bound(type.maximum),
      integer: type.type === "integer",
    };
  }
  if (
    Array.isArray(type.enum) &&
    type.enum.every((v) => typeof v === "string")
  ) {
    return { kind: "choice", options: type.enum as string[] };
  }
  const consts = constsOf(type.anyOf) ?? constsOf(type.oneOf);
  if (consts !== null) return { kind: "choice", options: consts };
  if (
    type.type === "array" &&
    (type.items as Schema | undefined)?.type === "string"
  ) {
    return { kind: "list" };
  }
  // `""`(비우면 기본) 또는 글 하나인 설정(`projects.worktrees_folder`)도 글 칸이다.
  const members = (type.anyOf ?? type.oneOf) as unknown;
  if (
    type.type === "string" ||
    (Array.isArray(members) &&
      members.length > 0 &&
      members.every((one) => (one as Schema | null)?.type === "string"))
  ) {
    return { kind: "text" };
  }
  return { kind: "fixed" };
}

/** 다른 자리가 보이는 설정은 General에 오지 않는다. 지침·skill·MCP 같은 내용물과 상태도 오지 않는다. */
const SHOWN_ELSEWHERE = [
  "shell.",
  // My computers 항목이 연결·hub·동기화·폴더 설정을 직접 다룬다.
  "remote.",
  "sync.",
  "folder.",
  // Diagnostics 항목이 trace를 켜고 끈다.
  "diagnostics.",
  PERMISSION_RULES_SETTING_KEY,
  WORKFLOW_MODES_SETTING_KEY,
  LOCAL_TOOL_TRUST_SETTING_KEY,
  // Coding agents 항목이 배포한 앱 skill 목록을 보이고 바꾼다.
  CODING_DEPLOYED_SKILLS_SETTING_KEY,
  "lophn-agent.extensions.",
  // Extensions 항목이 설치와 함께 켜고 끈다.
  "extensions.",
];

function shownInGeneral(key: string): boolean {
  return !SHOWN_ELSEWHERE.some((prefix) => key.startsWith(prefix));
}

/** 설정 key로 정한 message key. `shell.reading_width` → `settings.shell-reading_width.name`. */
function wordingKey(key: string, part: "name" | "help"): string {
  return `settings.${key.replaceAll(".", "-")}.${part}`;
}

function wording(key: string): string | null {
  return key in en ? t(key as MessageKey) : null;
}

/** 설정 이름. catalog에 없으면 key를 그대로 보인다. */
export function nameOf(key: string): string {
  const text = wording(wordingKey(key, "name"));
  return text === null ? key : text;
}

export function helpOf(key: string): string | null {
  return wording(wordingKey(key, "help"));
}

/** 묶음은 key의 첫 구간(그 설정을 선언한 요소)이다. */
function groupOf(key: string): string {
  return key.split(".")[0]!;
}

export function groupTitle(owner: string): string {
  return slugText(owner);
}

interface SettingGroup {
  readonly owner: string;
  readonly entries: readonly SettingEntry[];
}

/** 첫 구간별로 묶는다. 묶음과 묶음 안은 선언 순서를 지킨다. */
export function groupEntries(entries: readonly SettingEntry[]): SettingGroup[] {
  const groups = new Map<string, SettingEntry[]>();
  for (const entry of entries) {
    if (!shownInGeneral(entry.key)) continue;
    const owner = groupOf(entry.key);
    const found = groups.get(owner);
    if (found === undefined) groups.set(owner, [entry]);
    else found.push(entry);
  }
  return [...groups].map(([owner, list]) => ({ owner, entries: list }));
}

/** 값이 정해지지 않은 필수 설정(기본값도 없고 사람이 고르지도 않았다). */
export function isRequiredEmpty(entry: SettingEntry): boolean {
  return !entry.hasDefault && !entry.hasChosen;
}

export function currentValue(entry: SettingEntry): unknown {
  return entry.hasChosen ? entry.chosen : entry.defaultValue;
}

const MODE_LABELS: Readonly<Record<string, MessageKey>> = {
  read_only: "settings.label.mode-read_only",
  ask: "settings.label.mode-ask",
  workspace: "settings.label.mode-workspace",
  full: "settings.label.mode-full",
};

/** 기본값 글. 기본값이 없으면 없다고 말한다. */
export function defaultText(entry: SettingEntry): string {
  if (!entry.hasDefault) return t("settings.label.value-no-default");
  if (
    entry.key === DEFAULT_MODE_SETTING_KEY &&
    typeof entry.defaultValue === "string"
  ) {
    return choiceLabel(entry.defaultValue, entry.key);
  }
  return valueText(entry.defaultValue, true);
}

export function choiceLabel(option: string, key?: string): string {
  if (key === DEFAULT_MODE_SETTING_KEY) {
    const labelKey = MODE_LABELS[option];
    if (labelKey !== undefined) return t(labelKey);
  }
  return slugText(option);
}

/** 허용 범위 글. 범위가 없으면 null이다. */
export function rangeText(control: Extract<Control, { kind: "range" }>) {
  if (control.min !== null && control.max !== null) {
    return t("settings.note.allowed-range", {
      min: control.min,
      max: control.max,
    });
  }
  if (control.min !== null) {
    return t("settings.note.allowed-min", { min: control.min });
  }
  if (control.max !== null) {
    return t("settings.note.allowed-max", { max: control.max });
  }
  return null;
}

/** 거절 이유 글. 저장된 값은 그대로라는 말을 함께 한다. */
export function rejectionText(reason: SettingRejectReason): string {
  switch (reason) {
    case "unknown_key":
      return t("settings.error.value-unknown");
    case "wrong_type":
      return t("settings.error.value-wrong-type");
    case "out_of_range":
      return t("settings.error.value-out-of-range");
    case "invalid_value":
      return t("settings.error.value-invalid");
  }
}

/** 숫자 입력 글을 값으로. 비었거나 숫자가 아니면 null이다. */
export function numberOf(text: string): number | null {
  if (text.trim() === "") return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

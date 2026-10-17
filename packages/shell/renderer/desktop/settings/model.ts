// settings 화면의 순수 규칙. 원시 enum·ID를 화면 말로 바꾸고, 모르는 값을
// 지어내지 않는다. 화면 컴포넌트와 테스트가 같이 쓴다.
import { type MessageKey, t } from "@lophn/wording";

import type { LucideIcon } from "lucide-react";

import { settingsIcons } from "../../icons/mod.ts";
import type { AuthWay } from "./source.ts";

/** Settings의 항목. sidebar의 Settings 아래에 고르는 줄로 놓이고, 고른 항목의 본문 하나가 화면이 된다. */
export type SettingsPane =
  | "general"
  | "appearance"
  | "providers"
  | "agents"
  | "tools"
  | "coding"
  | "reactions"
  | "diagnostics";

interface SettingsPaneEntry {
  readonly id: SettingsPane;
  /** 항목 이름의 wording key. */
  readonly label: MessageKey;
  readonly icon: LucideIcon;
}

interface SettingsGroup {
  readonly id: "general" | "agents" | "system";
  /** 묶음 이름의 wording key. */
  readonly label: MessageKey;
  readonly panes: readonly SettingsPaneEntry[];
}

export const DEFAULT_PANE: SettingsPane = "general";

export const SETTINGS_GROUPS: readonly SettingsGroup[] = [
  {
    id: "general",
    label: "settings.label.group-general",
    panes: [
      {
        id: "general",
        label: "settings.label.tab-general",
        icon: settingsIcons.general,
      },
      {
        id: "appearance",
        label: "settings.label.tab-appearance",
        icon: settingsIcons.appearance,
      },
    ],
  },
  {
    id: "agents",
    label: "settings.label.group-agents",
    panes: [
      {
        id: "providers",
        label: "settings.label.tab-providers",
        icon: settingsIcons.providers,
      },
      {
        id: "agents",
        label: "settings.label.tab-agents",
        icon: settingsIcons.agents,
      },
      {
        id: "tools",
        label: "settings.label.tab-extensions",
        icon: settingsIcons.tools,
      },
      {
        id: "coding",
        label: "settings.label.tab-coding",
        icon: settingsIcons.coding,
      },
    ],
  },
  {
    id: "system",
    label: "settings.label.group-system",
    panes: [
      {
        id: "reactions",
        label: "settings.label.tab-reactions",
        icon: settingsIcons.reactions,
      },
      {
        id: "diagnostics",
        label: "settings.label.tab-diagnostics",
        icon: settingsIcons.diagnostics,
      },
    ],
  },
];

/**
 * 내장 정의가 알려 준 연결 방법만, 정해진 순서(로그인, key)로. 인증 없음은 내장 정의에 없고 직접 만든
 * custom provider의 loopback에만 있어 고르는 방법이 아니다.
 */
export function waysOf(
  ways: readonly AuthWay[],
): Exclude<AuthWay, "none">[] {
  const order: Exclude<AuthWay, "none">[] = ["oauth", "api_key"];
  return order.filter((way) => ways.includes(way));
}

export function wayLabel(way: AuthWay): string {
  switch (way) {
    case "oauth":
      return t("settings.label.way-sign-in");
    case "api_key":
      return t("settings.label.way-api-key");
    case "none":
      return t("settings.label.way-local");
  }
}

/** 저장 이름(`next_turn`)처럼 생긴 값은 첫 글자를 키운 낱말로, 사람이 쓴 글은 그대로 둔다. */
export function slugText(value: string): string {
  if (!/^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*$/.test(value)) return value;
  const words = value.replace(/[-_]/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** 설정 값을 사람의 말로. 목록·객체는 개수로만 말한다. */
export function valueText(value: unknown, resolved: boolean): string {
  if (!resolved) return t("settings.label.value-not-set");
  if (typeof value === "boolean") {
    return value ? t("settings.label.value-on") : t("settings.label.value-off");
  }
  if (typeof value === "number") {
    return new Intl.NumberFormat("en").format(value);
  }
  if (typeof value === "string") {
    return value === "" ? t("settings.label.value-not-set") : slugText(value);
  }
  if (Array.isArray(value)) {
    return t("settings.label.value-items", { count: value.length });
  }
  if (value !== null && typeof value === "object") {
    return t("settings.label.value-custom");
  }
  return t("settings.label.value-not-set");
}

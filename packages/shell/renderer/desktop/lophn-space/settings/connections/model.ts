// Coding agents 화면의 순수 계산: 제품마다 감지 결과와 맡길 수 있는지를 en 문구와 tone으로 바꾼다.
// 존재만으로 version·로그인이 확인됐다고 하지 않는다. 확인 못한 것은 확인 못했다고 말한다.
import type { StatusTone } from "@lophn/design";
import { t } from "@lophn/wording";

import type { HarnessSettingsView } from "./source.ts";

export function discoveryText(harness: HarnessSettingsView): string {
  switch (harness.discovery) {
    case "detected":
      return t("settings.label.coding-found");
    case "absent":
      return t("settings.label.coding-not-found");
    case "unobserved":
      return t("settings.label.coding-not-checked");
    default:
      return t("settings.label.coding-check-failed");
  }
}

export function discoveryTone(harness: HarnessSettingsView): StatusTone {
  switch (harness.discovery) {
    case "detected":
      return "good";
    case "absent":
    case "unobserved":
      return "neutral";
    default:
      return "warning";
  }
}

/** 못 찾은 제품은 version이 없다. 찾았어도 확인 못했으면 확인 못했다고 말한다. */
export function versionText(harness: HarnessSettingsView): string | null {
  if (harness.discovery !== "detected") return null;
  return harness.version_result === "verified" && harness.version !== null
    ? t("settings.label.coding-version", { version: harness.version })
    : t("settings.label.coding-version-unknown");
}

export function loginText(harness: HarnessSettingsView): string {
  switch (harness.login) {
    case "verified":
      return t("settings.label.coding-signed-in");
    case "not_verified":
      return t("settings.label.coding-sign-in-not-found");
    default:
      return t("settings.label.coding-sign-in-unknown");
  }
}

export function loginTone(harness: HarnessSettingsView): StatusTone {
  switch (harness.login) {
    case "verified":
      return "good";
    case "not_verified":
      return "warning";
    default:
      return "neutral";
  }
}

/** 못 찾은 제품은 turn 끝 신호도 맡길 수 있는지도 말하지 않는다. */
export function shown(harness: HarnessSettingsView): boolean {
  return harness.discovery === "detected";
}

/** 기본 제품으로 고를 수 있는 제품: 첫 prompt를 넘길 수 있는 것뿐이다. */
export function pickable(harness: HarnessSettingsView): boolean {
  return harness.can_launch;
}

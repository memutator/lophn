// Coding agents 화면의 순수 계산: 제품마다 감지 결과를 en 문구와 tone으로 바꾼다.
// 존재만으로 version이 확인됐다고 하지 않는다. 확인 못한 것은 확인 못했다고 말한다.
import type { StatusTone } from "@lophn/ui";
import { t } from "@lophn/wording";

import type { HarnessHookView, HarnessSettingsView } from "./source.ts";

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

/** 못 찾은 제품은 turn 끝 신호를 말하지 않는다. */
export function shown(harness: HarnessSettingsView): boolean {
  return harness.discovery === "detected";
}

/** unsupported는 hook이 없는 제품이라 보일 것도 누를 것도 없다. */
export function hookText(hook: HarnessHookView): string | null {
  switch (hook.status) {
    case "installed":
      return t("settings.label.coding-hooks-installed");
    case "missing":
      return t("settings.label.coding-hooks-missing");
    case "failed":
      return t("settings.label.coding-hooks-failed");
    default:
      return null;
  }
}

export function hookTone(hook: HarnessHookView): StatusTone {
  switch (hook.status) {
    case "installed":
      return "good";
    case "failed":
      return "warning";
    default:
      return "neutral";
  }
}

/** 찾은 제품이 먼저, 그 안과 나머지는 받은 순서를 지킨다. */
export function sortedByFound(
  harnesses: readonly HarnessSettingsView[],
): HarnessSettingsView[] {
  return [
    ...harnesses.filter(shown),
    ...harnesses.filter((harness) => !shown(harness)),
  ];
}

/** 이름이나 id에 검색어가 들어 있는 제품. 빈 검색어는 모두다. */
export function matchesQuery(
  harness: HarnessSettingsView,
  query: string,
): boolean {
  const needle = query.trim().toLowerCase();
  return (
    harness.label.toLowerCase().includes(needle) ||
    harness.harness_id.includes(needle)
  );
}

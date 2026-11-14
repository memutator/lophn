// Extensions 화면의 순수 계산: registry가 준 상태를 en 문구와 tone으로 바꾼다.
import type { StatusTone } from "@lophn/ui";
import { t } from "@lophn/i18n";

import type { ExtensionView } from "../../../../ipc/extensions.ts";

export function statusText(view: ExtensionView): string {
  switch (view.status) {
    case "on":
      return t("settings.label.extension-on");
    case "off":
      return t(
        view.installed
          ? "settings.label.extension-off"
          : "settings.label.extension-not-installed",
      );
    default:
      return t("settings.label.extension-problem");
  }
}

export function statusTone(view: ExtensionView): StatusTone {
  switch (view.status) {
    case "on":
      return "good";
    case "off":
      return "neutral";
    default:
      return "warning";
  }
}

export const enabledKey = (id: string): string => `extensions.${id}.enabled`;

// Diagnostics의 순수 규칙: 구성 요소 이름과 점검 시각을 화면 말로 바꾼다. 모르는 이름은 지어내지 않고
// 저장 이름을 읽기 쉽게만 바꾼다.
import { formatDate, t } from "@lophn/wording";

import { slugText } from "../model.ts";

export function componentName(component: string): string {
  switch (component) {
    case "core":
      return t("settings.label.component-core");
    case "ledger":
      return t("settings.label.component-ledger");
    case "events":
      return t("settings.label.component-events");
    case "app-runtime":
      return t("settings.label.component-app-runtime");
    case "sandbox":
      return t("settings.label.component-sandbox");
    case "agent-runtime":
      return t("settings.label.component-agent-runtime");
    default:
      return slugText(component);
  }
}

const CLOCK: Intl.DateTimeFormatOptions = {
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
};

/** 점검한 시각을 시:분:초로. 실제로 점검한 때를 보인다. */
export function clockText(iso: string): string {
  return formatDate(new Date(iso), "en", CLOCK);
}

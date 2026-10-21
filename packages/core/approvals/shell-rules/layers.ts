import {
  PRODUCT_SHELL_RULES,
  type ShellRuleLayers,
  type ShellRulesSetting,
} from "../../../protocol/approvals/mod.ts";
import type { Place } from "../../../protocol/lophn-agent/places.ts";

// 앱 place의 turn은 project 층이 없다. 제품 기본과 전역만 본다.
export function shellRuleLayers(
  value: ShellRulesSetting,
  place: Place | null,
): ShellRuleLayers {
  return {
    floor: PRODUCT_SHELL_RULES.floor,
    layers: [
      PRODUCT_SHELL_RULES.ask,
      value.global,
      place?.kind === "project" ? value.projects[place.id] ?? [] : [],
    ],
  };
}

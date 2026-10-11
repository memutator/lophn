// 카드의 줄: 종류 수·적용된 판과 검사 결과·위반 수·쓰는 Operator 수 순서(shell/workspace#R16).
import { t } from "@lophn/wording";

import type { CardData } from "./contexts-tab-load.ts";

export interface CardRow {
  readonly key: "kinds" | "version" | "violations" | "operators";
  readonly text: string;
  readonly warn: boolean;
}

export function cardRows(card: CardData): readonly CardRow[] {
  const { item, kinds, version, operators } = card;
  const rows: CardRow[] = [];
  if (kinds.length > 0) {
    rows.push({
      key: "kinds",
      text: t("contexts.label.tab-kinds", {
        count: kinds.length,
        names: kinds.join(", "),
      }),
      warn: false,
    });
  }
  rows.push({
    key: "version",
    text: version === null || item.applied_number === null
      ? t("contexts.label.tab-version-none")
      : t(`contexts.label.tab-version-${version}`, {
        number: String(item.applied_number),
      }),
    warn: false,
  });
  const violations = item.violation_mark;
  rows.push({
    key: "violations",
    text: violations === 0
      ? t("contexts.label.tab-no-violations")
      : t("contexts.label.tab-violations", { count: violations }),
    warn: violations > 0,
  });
  rows.push({
    key: "operators",
    text: t("contexts.label.tab-operators", { count: operators }),
    warn: false,
  });
  return rows;
}

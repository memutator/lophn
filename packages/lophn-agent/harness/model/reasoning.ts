import {
  type CatalogEntry,
  orderedLevels,
  type ResolvedModel,
} from "../../../contracts/lophn-agent/mod.ts";
import type { Result } from "../../../base/mod.ts";
import { err, ok } from "../../../base/mod.ts";
import { clampBudgetTokens } from "./budget.ts";

// 추론 수준 규칙이다. catalog에서 확인된 이름을 provider 인자로 치환하지 않는다
// (R16, R20). 순수 규칙만 두고 I/O는 없다.

export const ORDERED_LEVELS = orderedLevels;

export function levelRank(level: string): number {
  return orderedLevels.indexOf(level as (typeof orderedLevels)[number]);
}

// 일곱 수준 안의 순서 비교다. provider_default는 순서 밖이라 비교 대상이 아니다(R15).
export function isOrderedLevel(level: string): boolean {
  return levelRank(level) >= 0;
}

// run은 시작한 추론 수준을 유지하고 개별 요청은 고정 Preset 선택의 명시 수준보다
// 높이지 못한다(R18). run 수준이 없으면 고정할 것이 없다.
export function requestLevelWithinRun(
  startedLevel: string | null,
  requestedLevel: string,
): Result<string> {
  if (startedLevel === null) return ok(requestedLevel);
  if (!isOrderedLevel(startedLevel) || !isOrderedLevel(requestedLevel)) {
    return err({
      code: "invalid_input",
      message: "run 수준은 일곱 수준 안에서만 다룬다",
    });
  }
  if (levelRank(requestedLevel) > levelRank(startedLevel)) {
    return err({
      code: "invalid_input",
      message: "run 중 추론 수준을 높이지 않는다",
    });
  }
  return ok(requestedLevel);
}

export type ReasoningArgs =
  | { kind: "none" }
  | { kind: "named"; level: string }
  | { kind: "toggle"; on: boolean }
  | { kind: "budget"; tokens: number }
  | { kind: "provider_default"; level: string };

export type ReasoningMode = CatalogEntry["reasoning"]["mode"];

// catalog에서 확인된 강도 이름만 보내고 치환하지 않는다(R16). minimal→low 같은
// 대체가 없다. 모델에 맡김(provider_default)이며 보정된 기본 수준이 없으면 추론
// 인자를 보내지 않는다(R16). none 모드는 인자가 아니다(R15).
export function reasoningArgs(
  model: Pick<ResolvedModel, "reasoning_level">,
  entry: CatalogEntry,
): ReasoningArgs | undefined {
  const level = model.reasoning_level;
  if (level === "off") return { kind: "none" };
  const support = entry.reasoning;
  if (!isOrderedLevel(level)) return undefined;
  // budget 모드의 수준별 token이다. low·medium·high·maximum만 budget 모드에서
  // 확인된 예산을 받는다(R17).
  const budgetTokens = () =>
    level === "low" || level === "medium" || level === "high" ||
      level === "maximum"
      ? clampBudgetTokens(
        level,
        support.minimum_budget,
        support.maximum_budget,
      )
      : null;
  switch (support.mode) {
    case "none":
      return { kind: "none" };
    // 모델에 맡김에서 보정된 기본 수준이 없으면 추론 인자가 없다(R16).
    case "unknown":
      return undefined;
    case "named":
      // named는 catalog에서 확인된 수준만 제공한다. 목록에 없는 이름은 인자가 아니다.
      return support.levels.includes(level)
        ? { kind: "named", level }
        : undefined;
    // 토글 방식은 끔·높음만 제공한다(R17).
    case "toggle": {
      if (!support.levels.includes(level)) return undefined;
      return { kind: "toggle", on: level === "high" };
    }
    case "budget": {
      const tokens = budgetTokens();
      return tokens === null ? undefined : { kind: "budget", tokens };
    }
    default:
      return undefined;
  }
}

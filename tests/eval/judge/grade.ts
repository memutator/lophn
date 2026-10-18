import type { Criterion, JudgeItem } from "../types.ts";
import type { JudgeDefinition } from "./definition.ts";

export function quoteInInput(input: string, quote: string): boolean {
  const q = quote.trim();
  return q !== "" && input.includes(q);
}

export function newJudgeItem(
  args: {
    check: string;
    criterion: Criterion;
    input: string;
    judge: JudgeDefinition;
  },
): JudgeItem {
  const { check, criterion, input, judge } = args;
  return {
    check,
    criterion: `${criterion.name}@${criterion.n}`,
    input,
    state: "pending",
    model: null,
    verdict: null,
    quote: null,
    quote_found: false,
    judge: `judge@${judge.n}`,
    error: null,
  };
}

// 답이 enum 밖이거나 인용이 입력에 없으면 기록하되 error로 남긴다. 사람이 나중에 같은 입력으로 다시 본다.
export function gradeItem(
  item: JudgeItem,
  criterion: Criterion,
  answer: { verdict: unknown; quote: unknown; model: string },
): JudgeItem {
  const graded: JudgeItem = {
    ...item,
    model: answer.model,
    verdict: null,
    quote: null,
    quote_found: false,
    error: null,
  };
  const { verdict, quote } = answer;
  if (typeof verdict !== "string" || !criterion.verdicts.includes(verdict)) {
    graded.error = `verdict not allowed: ${verdict}`;
  } else {
    graded.verdict = verdict;
    if (typeof quote !== "string") {
      graded.error = "no quote";
    } else {
      graded.quote = quote;
      graded.quote_found = quoteInInput(item.input, quote);
      if (!graded.quote_found) graded.error = "quote not in input";
    }
  }
  graded.state = graded.error === null ? "judged" : "error";
  return graded;
}

// 정상 채점은 덮지 않는다. 대기이거나 오류인 것만 다시 채점한다.
export function canRegrade(item: JudgeItem): boolean {
  return item.state === "pending" || item.error !== null;
}

export function judgePassed(criterion: Criterion, item: JudgeItem): boolean {
  return item.state === "judged" && item.error === null && item.quote_found &&
    item.verdict !== null && criterion.pass.includes(item.verdict);
}

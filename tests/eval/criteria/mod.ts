import { type Criterion, parseRef } from "../types.ts";

export const CRITERIA_DIR = new URL("./", import.meta.url);

// judge 입력의 칸 이름. criterion의 question 안 설명과 같아야 한다.
export const INPUT_SECTIONS: Record<string, string[]> = {
  "relay-complete": ["HUMAN_REQUEST", "CALL_BODY"],
  "asks-gap": ["HUMAN_REQUEST", "QUESTIONS"],
  "card-covered": ["CARD", "BLUEPRINT", "TICKETS"],
  "asked-again": ["HUMAN_REQUEST", "QUESTIONS"],
  "root-cause": ["BUG", "TICKET_GOALS", "EVIDENCE_FILES"],
  "repeat-kind": ["REPEATED_CALL", "TIMELINE"],
};

export async function loadCriterion(ref: string): Promise<Criterion> {
  const { name, n } = parseRef(ref, "criterion");
  const criterion: Criterion = JSON.parse(
    await Deno.readTextFile(new URL(`./${name}.json`, CRITERIA_DIR)),
  );
  if (criterion.n !== n) {
    throw new Error(
      `criterion ${ref}가 이 checkout에 없다: file은 @${criterion.n}`,
    );
  }
  const { verdicts, pass } = criterion;
  if (
    !verdicts.includes("cannot_tell") || pass.includes("cannot_tell") ||
    !pass.every((verdict) => verdicts.includes(verdict))
  ) {
    throw new Error(`criterion ${ref}의 verdicts나 pass가 틀렸다`);
  }
  return criterion;
}

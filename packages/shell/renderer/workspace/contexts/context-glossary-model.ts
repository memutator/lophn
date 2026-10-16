// Glossary 화면의 순수한 계산: 사람이 고친 값에서 바뀐 field만 고르고, 누가·언제 문구를 고른다.
import { formatRelativeTime, t } from "@lophn/wording";

import type { GlossaryEntry } from "./source.ts";

/** 용어 칸과 뜻 칸에 사람이 쓴 값. 저장 전이라 공백이 있을 수 있다. */
export interface TermDraft {
  readonly term: string;
  readonly meaning: string;
}

/** 바뀐 field만 담는다. 고치기 명령의 본문 조각이다. */
export interface GlossaryChanges {
  readonly term?: string;
  readonly meaning?: string;
}

/** 앞뒤 공백을 자른 뒤 원래 항목과 다른 field만 고른다. 바뀐 것이 없으면 null. */
export function changesOf(
  entry: GlossaryEntry,
  draft: TermDraft,
): GlossaryChanges | null {
  const term = draft.term.trim();
  const meaning = draft.meaning.trim();
  const changes: { term?: string; meaning?: string } = {};
  if (term !== entry.term) changes.term = term;
  if (meaning !== entry.meaning) changes.meaning = meaning;
  return Object.keys(changes).length === 0 ? null : changes;
}

/** 용어나 뜻이 비었거나 공백만 있으면 저장할 수 없다. */
export function isBlank(draft: TermDraft): boolean {
  return draft.term.trim() === "" || draft.meaning.trim() === "";
}

/** 정한 쪽: 사람이면 You, 아니면 Project Manager. */
export function setByLabel(setBy: GlossaryEntry["set_by"]): string {
  return setBy === "user"
    ? t("contexts.label.glossary-by-user")
    : t("contexts.label.glossary-by-project-manager");
}

/** 정한 시각을 "2 days ago" 같은 상대 시각으로. */
export function whenLabel(updatedAt: string, now: Date): string {
  return formatRelativeTime(new Date(updatedAt), now);
}

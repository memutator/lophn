// context 화면들이 같이 쓰는 작은 값. 화면 하나의 파일에 두면 다른 화면이 그 파일을 import해야 해서
// 병렬로 만들기 어려우므로 여기 둔다.
import { t } from "@lophn/wording";

/** Context 탭의 하위 탭. 순서가 화면 순서다. */
export const SUB_TABS = [
  "overview",
  "search",
  "violations",
  "glossary",
  "contract",
] as const;
export type SubTab = typeof SUB_TABS[number];

export const SUB_TAB_LABELS: Readonly<Record<SubTab, string>> = {
  overview: "Overview",
  search: "Search",
  violations: "Violations",
  glossary: "Glossary",
  contract: "Contract",
};

/** Search 탭 이름: "Search · eval". */
export function searchTabTitle(context: string | undefined): string {
  const kind = t("contexts.label.rail-search");
  return context === undefined ? kind : `${kind} · ${context}`;
}

/**
 * 도메인 객체(exp-008, F-009)와 문서 이름 링크가 누르면 부르는 함수. 인자는 project 폴더
 * 기준 상대 경로이고, 어떤 문서 탭을 열지는 부른 쪽(탭 kind)이 정한다.
 */
export type OpenDocument = (path: string) => void;

/** 범위 입력이 내는 값. 빈 글자는 열린 끝이다. */
export interface RangeValue {
  readonly from: string;
  readonly to: string;
}

import type { ReactNode } from "react";

export interface Page {
  /** 주소 `#/<id>`와 frame의 `?frame=<id>`에 쓴다. */
  readonly id: string;
  /** 화면 이름. 영어로 쓴다. */
  readonly title: string;
  /** 한두 문장. 한국어로 쓴다. */
  readonly description: string;
  readonly render: () => ReactNode;
  /** frame 높이(px). 폰 화면 여러 장을 줄지어 그리는 board처럼 기본 800보다 긴 page만 준다. */
  readonly height?: number;
}

/** 영역 하나는 파일 하나가 자기 page 목록과 그리는 함수를 같이 낸다. */
export interface Area {
  readonly id: string;
  readonly title: string;
  /** 첫 화면 카드의 한 줄. */
  readonly summary: string;
  readonly pages: readonly Page[];
}

export interface Group {
  readonly id: "kit" | "screens" | "drafts";
  readonly title: string;
  readonly summary: string;
  /** true면 page를 frame 없이 본문에 그린다. false면 iframe에 그린다. */
  readonly inline: boolean;
  readonly areas: readonly Area[];
}

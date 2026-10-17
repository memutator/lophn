// layout: page와 영역을 짜는 frame.
// 12열 대시보드 frame. DashboardCell로 칸 폭을 나눠 StatTile·차트를 놓는다.
export { DashboardFrame } from "./page-frames/frames.tsx";
// DashboardFrame 안의 칸. span(1-12)으로 폭을 정한다.
export { DashboardCell, type DashboardSpan } from "./page-frames/frames.tsx";
// 폼 frame. 640px 한 기둥에 Field들을 놓는 설정·입력 page에 쓴다.
export { FormFrame } from "./page-frames/frames.tsx";
// 왼쪽 목록과 오른쪽 상세를 나란히 놓는 frame. 좁은 칸에서는 한 쪽씩 보인다.
export {
  ListDetailFrame,
  type ListDetailFrameProps,
} from "./page-frames/frames.tsx";
// 칸 끝까지 가는 표 frame. 머리만 여백을 쓴다. 표가 아닌 폭 제한 본문은 ReadingFrame이다.
export { TableFrame } from "./page-frames/frames.tsx";
// 읽는 본문 frame. 읽기 폭을 제한하고 칸이 넓으면 목차를 옆에 둔다.
export {
  ReadingFrame,
  type ReadingFrameProps,
} from "./page-frames/reading-frame.tsx";
// frame의 폭 계산 helper. 같은 계산이 필요한 test와 목차 자리 판단이 쓴다.
export {
  columnBox,
  READING_WIDTHS,
  readingBox,
  type ReadingWidth,
  type TocPlacement,
  tocSideMinimum,
} from "./page-frames/model.ts";
// 전역 읽기 폭 선택을 읽고 쓰는 helper. 저장은 호출자의 settings가 맡는다.
export {
  DEFAULT_READING_WIDTH,
  readingWidthOf,
  type ReadingWidthSetting,
  useReadingWidth,
} from "./page-frames/reading-width.ts";
// ReadingFrame이 정한 목차 자리(옆/머리)를 읽는 hook. 목차 component를 새로 만들 때 쓴다.
export { useTocPlacement } from "./page-frames/toc-placement.ts";
// 독립 객체 하나를 묶는 면. 카드 안에 카드를 두지 않는다.
export { Card, type CardProps } from "./card/card.tsx";

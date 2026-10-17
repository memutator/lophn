// page와 영역을 짜는 frame.
export {
  DashboardCell,
  DashboardFrame,
  type DashboardSpan,
  FormFrame,
  ListDetailFrame,
  type ListDetailFrameProps,
  TableFrame,
} from "./page-frames/frames.tsx";
export {
  ReadingFrame,
  type ReadingFrameProps,
} from "./page-frames/reading-frame.tsx";
export {
  columnBox,
  READING_WIDTHS,
  readingBox,
  type ReadingWidth,
  type TocPlacement,
  tocSideMinimum,
} from "./page-frames/model.ts";
export {
  DEFAULT_READING_WIDTH,
  readingWidthOf,
  type ReadingWidthSetting,
  useReadingWidth,
} from "./page-frames/reading-width.ts";
export { useTocPlacement } from "./page-frames/toc-placement.ts";
export { Card, type CardProps } from "./card/card.tsx";

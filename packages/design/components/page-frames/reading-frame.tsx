import type { ReactNode } from "react";
import { usePane } from "./frames.tsx";
import { panePaddingPixels, type ReadingWidth, tocPlacement } from "./model.ts";
import styles from "./page-frames.module.css";
import { TocPlacementContext } from "./toc-placement.ts";

export interface ReadingFrameProps {
  // 읽기 폭은 호출자가 정한다. 전역 선택은 useReadingWidth로 이어 준다.
  width: ReadingWidth;
  header?: ReactNode;
  // 목차. 칸 폭이 넓으면 본문 오른쪽, 좁으면 머리 아래에 그린다.
  toc?: ReactNode;
  children: ReactNode;
}

// 읽기 본문 600/680/800px과 목차 220px. 별도 메타 패널은 두지 않는다.
export function ReadingFrame(
  { width, header, toc, children }: ReadingFrameProps,
) {
  const { ref, pane, pad } = usePane();
  const placement = pane === undefined
    ? "head"
    : tocPlacement(pane - panePaddingPixels(pane) * 2, width);
  return (
    <div
      ref={ref}
      className={styles.frame}
      data-frame="reading"
      data-pad={pad}
    >
      <div className={styles.pad}>
        <div
          className={styles.reading}
          data-width={width}
          data-toc={toc === undefined ? "none" : placement}
        >
          <div className={styles.readingBody}>
            {header !== undefined && (
              <header className={styles.head}>{header}</header>
            )}
            {toc !== undefined && placement === "head" && (
              <div className={styles.tocHead}>
                <TocPlacementContext.Provider value="head">
                  {toc}
                </TocPlacementContext.Provider>
              </div>
            )}
            <article className={styles.article}>{children}</article>
          </div>
          {toc !== undefined && placement === "side" && (
            <aside className={styles.tocSide}>
              <TocPlacementContext.Provider value="side">
                {toc}
              </TocPlacementContext.Provider>
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}

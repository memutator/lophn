// 정보 패널의 내용. 틀(320px, 머리 36px, 탭, 기본 닫힘, 공간별 열림·마지막 탭
// 기억, overlay 닫기)은 작업대의 정보 패널 자리가 두고, 여기는 focus 칸의 문서에 대한
// 정보 탭 본문을 그린다. 안 여백 16px·절 간격 20px는 CSS가 정한다.
import { t } from "@lophn/wording";

import styles from "./info-panel.module.css";

export type InfoTabId = "info" | "contexts";

export interface DocumentInfoPanelProps {
  tab: InfoTabId;
  /** focus 칸의 활성 문서 탭. 문서가 아니면 null이다. */
  document: string | null;
  /** 문서의 등록 폴더 기준 경로. 편집기가 문서를 읽기 전에는 모른다. */
  path: string | null;
}

export function DocumentInfoPanel(
  { tab, document, path }: DocumentInfoPanelProps,
) {
  if (document === null) {
    return <p className={styles.muted}>{t("document.notice.no-document")}</p>;
  }
  if (tab === "contexts") {
    // 문서가 든 context는 작업대가 context.containing으로 읽어 이 자리에 DocumentContexts를 낀다.
    // 그 통로가 없는 창에는 보일 context가 없다.
    return <p className={styles.muted}>{t("document.empty.contexts")}</p>;
  }
  return (
    <div className={styles.stack} data-info-facts="">
      <section className={styles.section}>
        <h3 className={styles.caption}>{t("document.label.info-file")}</h3>
        <p className={styles.value} data-info-file="">
          {path ?? document}
        </p>
      </section>
    </div>
  );
}

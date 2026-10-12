// 충돌 해결 화면(shell/editor#R15): 편집기 초안을 지금 디스크 파일(또는 최신 판)과 줄 단위로
// 비교하고 사람이 고른다. 자동으로 합치거나 덮어쓰지 않는다. 고르기 전까지 초안은 그대로다.
// 비교는 차이를 이해하는 화면이라 primary 버튼을 두지 않는다(R14와 같은 규칙).
import { useMemo } from "react";
import { Button } from "@lophn/design/components";
import { DiffView } from "@lophn/design/reading";
import { t } from "@lophn/wording";

import { compareLines } from "./compare.ts";
import styles from "./conflict.module.css";

export interface ConflictViewProps {
  /** disk: 이 편집기 밖에서 바뀐 파일. newest: 편집하는 사이 생긴 최신 판. */
  against: "disk" | "newest";
  theirs: string;
  mine: string;
  onKeepMine: () => void;
  onUseTheirs: () => void;
  onBack: () => void;
}

export function ConflictView(
  { against, theirs, mine, onKeepMine, onUseTheirs, onBack }: ConflictViewProps,
) {
  const lines = useMemo(() => compareLines(theirs, mine), [theirs, mine]);
  return (
    <section
      className={styles.view}
      data-conflict-view={against}
      aria-label={against === "disk"
        ? t("document.title.compare-disk")
        : t("document.title.compare-newest")}
    >
      <div className={styles.bar}>
        <h2 className={styles.title}>
          {against === "disk"
            ? t("document.title.compare-disk")
            : t("document.title.compare-newest")}
        </h2>
        <div className={styles.actions}>
          <Button variant="ghost" size="sm" onClick={onBack}>
            {t("document.button.back-to-editing")}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            data-conflict-theirs=""
            onClick={onUseTheirs}
          >
            {against === "disk"
              ? t("document.button.use-disk")
              : t("document.button.use-newest")}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            data-conflict-mine=""
            onClick={onKeepMine}
          >
            {t("document.button.keep-mine")}
          </Button>
        </div>
      </div>
      <p className={styles.legend}>
        {against === "disk"
          ? t("document.label.compare-disk")
          : t("document.label.compare-newest")}
      </p>
      <div className={styles.diff}>
        <DiffView lines={lines} />
      </div>
    </section>
  );
}

// Follow changes 항목의 상태. 확인된 변화·section 소실·미확인을 서로 다른 글로 말하고 미확인을
// 변화로 꾸미지 않는다(documents/contexts#R9, R10, R11). 앱 자료는 자동으로 확인하지 않는다(R13).
import { Button } from "@lophn/design/components";
import { t } from "@lophn/wording";

import type { WatchState } from "../model.ts";
import type { DocumentTarget } from "../source.ts";
import styles from "../contexts.module.css";

export type Tone = "muted" | "info" | "warning";

/** 줄에 보이는 짧은 상태 글과 색조. */
export function watchLabel(state: WatchState): { text: string; tone: Tone } {
  switch (state.kind) {
    case "app":
      return { text: "", tone: "muted" };
    case "unread":
      return { text: t("contexts.label.watch-unread"), tone: "muted" };
    case "quiet":
      return { text: t("contexts.label.watch-quiet"), tone: "muted" };
    case "changed":
      return {
        text: state.change.kind === "section_added"
          ? t("contexts.label.watch-added")
          : t("contexts.label.watch-changed"),
        tone: "info",
      };
    case "missing":
      return { text: t("contexts.label.watch-missing"), tone: "warning" };
    case "unverified":
      return { text: t("contexts.label.watch-unverified"), tone: "warning" };
  }
}

/** 펼친 항목의 설명과 바뀐 판 열기. */
export function WatchDetail(
  { state, target, onRead }: {
    state: WatchState;
    target: DocumentTarget | null;
    onRead: (version: string | null, section: string | null) => void;
  },
) {
  if (state.kind === "app") {
    return <p className={styles.hint}>{t("contexts.notice.watch-app")}</p>;
  }
  if (state.kind === "unverified") {
    const message = state.reason === "pending"
      ? t("contexts.notice.watch-pending")
      : state.reason === "format"
      ? t("contexts.notice.watch-format")
      : t("contexts.notice.watch-other");
    return (
      <p className={styles.notice} data-watch-reason={state.reason}>
        {message}
      </p>
    );
  }
  if (state.kind === "missing") {
    return (
      <div className={styles.field}>
        <p className={styles.notice} data-watch-missing="">
          {t("contexts.notice.watch-missing")}
        </p>
        {state.change?.beforeVersion
          ? (
            <div className={styles.buttons}>
              <Button
                size="sm"
                data-open-before=""
                onClick={() =>
                  onRead(state.change!.beforeVersion, target?.section ?? null)}
              >
                {t("contexts.button.open-before")}
              </Button>
            </div>
          )
          : null}
      </div>
    );
  }
  if (state.kind === "changed") {
    const change = state.change;
    return (
      <div className={styles.buttons} data-watch-change={change.kind}>
        {change.beforeVersion
          ? (
            <Button
              size="sm"
              data-open-before=""
              onClick={() =>
                onRead(
                  change.beforeVersion,
                  change.kind === "section_added"
                    ? null
                    : change.target.section,
                )}
            >
              {t("contexts.button.open-before")}
            </Button>
          )
          : null}
        <Button
          size="sm"
          data-open-after=""
          onClick={() => onRead(change.afterVersion, change.target.section)}
        >
          {t("contexts.button.open-after")}
        </Button>
      </div>
    );
  }
  return null;
}

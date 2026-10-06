// 앱 패널·카드 위의 shell 크롬(shell/app-frame#R34). 앱 이름·모드·연결 상태와 그 view에 묶인
// [Report a problem]을 앱 bounds 밖 shell renderer에 둔다. 앱 화면이 멈추거나 깨져도 이 줄은
// shell이 그리므로 그대로 동작한다. 버튼은 이 크롬이 감싼 view_session 하나에만 묶인다.
import { Button, StatusMark } from "@lophn/design/components";
import { t } from "@lophn/wording";

import type { AppFrameViewState } from "../../ipc/app-frame.ts";
import styles from "./view-chrome.module.css";

type Connection = AppFrameViewState["connectionState"];

const CONNECTION = {
  preparing: { tone: "neutral", label: "common.label.app-state-preparing" },
  running: { tone: "good", label: "common.label.app-state-running" },
  stopped: { tone: "warning", label: "common.label.app-state-stopped" },
  unavailable: {
    tone: "critical",
    label: "common.label.app-state-unavailable",
  },
} as const satisfies Record<Connection, unknown>;

export interface ViewChromeProps {
  /** 사람이 지은 앱 이름. */
  name: string;
  mode: "live" | "preview";
  /** 아직 view가 없으면 null이다. */
  connection: Connection | null;
  /** 이 크롬이 감싼 view. 없으면 문제 알리기를 누를 수 없다. */
  viewSession: string | null;
  onReport?: (view_session: string) => void;
}

export function ViewChrome(
  { name, mode, connection, viewSession, onReport }: ViewChromeProps,
) {
  const state = connection === null ? null : CONNECTION[connection];
  return (
    <div
      className={styles.chrome}
      data-view-chrome=""
      data-view-session={viewSession ?? undefined}
    >
      <span className={styles.name} data-view-app-name="">{name}</span>
      <span className={styles.mode} data-view-mode={mode}>
        {t(
          mode === "live"
            ? "common.label.app-mode-live"
            : "common.label.app-mode-preview",
        )}
      </span>
      {state === null ? null : (
        <span data-view-connection={connection}>
          <StatusMark tone={state.tone} label={t(state.label)} />
        </span>
      )}
      <span className={styles.end}>
        <Button
          size="sm"
          variant="ghost"
          data-report-problem={viewSession ?? ""}
          disabled={viewSession === null || onReport === undefined}
          onClick={() => {
            if (viewSession !== null) onReport?.(viewSession);
          }}
        >
          {t("common.button.report-problem")}
        </Button>
      </span>
    </div>
  );
}

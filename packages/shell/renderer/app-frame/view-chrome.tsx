// 앱 패널·카드 위의 shell 크롬. 앱 이름·모드·연결 상태와 그 view에 묶인
// [Report a problem]을 앱 bounds 밖 shell renderer에 둔다. 앱 화면이 멈추거나 깨져도 이 줄은
// shell이 그리므로 그대로 동작한다. 버튼은 이 크롬이 감싼 view_session 하나에만 묶인다.
// 화면이 멈추거나 crash하면 그 상태와 [Open again]을 둔다. 새 view는 사람이 누를 때만 지금
// 연결로 연다.
import { Flag } from "lucide-react";
import { Button, IconButton } from "@lophn/ui/primitives";
import { StatusMark } from "@lophn/ui/feedback";
import { Tooltip } from "@lophn/ui/overlay";
import { t } from "@lophn/wording";

import type { AppFrameViewState } from "../../ipc/app-frame.ts";
import styles from "./view-chrome.module.css";

type Connection = AppFrameViewState["connectionState"];
type Health = NonNullable<AppFrameViewState["viewHealth"]>;

const HEALTH = {
  unresponsive: {
    tone: "warning",
    label: "common.label.app-view-unresponsive",
  },
  crashed: { tone: "critical", label: "common.label.app-view-crashed" },
} as const satisfies Record<Exclude<Health, "ok">, unknown>;

const CONNECTION = {
  preparing: { tone: "neutral", label: "common.label.app-state-preparing" },
  running: { tone: "good", label: "common.label.app-state-running" },
  stopped: { tone: "warning", label: "common.label.app-state-stopped" },
  unavailable: {
    tone: "critical",
    label: "common.label.app-state-unavailable",
  },
} as const satisfies Record<Connection, unknown>;

interface ViewChromeProps {
  /** 사람이 지은 앱 이름. */
  name: string;
  mode: "live" | "preview";
  /** 아직 view가 없으면 null이다. */
  connection: Connection | null;
  /** 이 크롬이 감싼 view. 없으면 문제 알리기를 누를 수 없다. */
  viewSession: string | null;
  onReport?: (view_session: string) => void;
  /** 화면 process 상태. 없으면 ok다. */
  health?: Health;
  /** 깨진 view를 지금 연결로 새로 연다. */
  onReopen?: (view_session: string) => void;
}

export function ViewChrome(
  { name, mode, connection, viewSession, onReport, health, onReopen }:
    ViewChromeProps,
) {
  const state = connection === null ? null : CONNECTION[connection];
  const broken = health === undefined || health === "ok"
    ? null
    : HEALTH[health];
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
      {broken === null ? null : (
        <span data-view-health={health}>
          <StatusMark tone={broken.tone} label={t(broken.label)} />
        </span>
      )}
      <span className={styles.end}>
        {broken === null ? null : (
          <Button
            size="sm"
            variant="secondary"
            data-reopen-view={viewSession ?? ""}
            disabled={viewSession === null || onReopen === undefined}
            onClick={() => {
              if (viewSession !== null) onReopen?.(viewSession);
            }}
          >
            {t("common.button.open-again")}
          </Button>
        )}
        <Tooltip content={t("common.button.report-problem")}>
          <IconButton
            icon={Flag}
            label={t("common.button.report-problem")}
            size="sm"
            data-report-problem={viewSession ?? ""}
            disabled={viewSession === null || onReport === undefined}
            onClick={() => {
              if (viewSession !== null) onReport?.(viewSession);
            }}
          />
        </Tooltip>
      </span>
    </div>
  );
}

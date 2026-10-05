import {
  IconButton,
  retryIcon,
  StatusMark,
  Tooltip,
} from "@lophn/design/components";
import { t } from "@lophn/wording";

import {
  type Ending,
  endingWording,
  type Refusal,
  REFUSAL_KEY,
} from "./model.ts";
import styles from "./terminal.module.css";

export type BannerState =
  | { kind: "ended"; ending: Ending; exitCode: number | null }
  | { kind: "not_started" }
  | { kind: "refused"; reason: Refusal };

export interface ExitBannerProps {
  state: BannerState;
  /** 사람이 누를 때만 새 shell을 시작한다. 없으면 버튼을 두지 않는다. */
  onRestart?: () => void;
}

// 출력 옆의 상태 줄. 확인된 exit code·시작 실패·결과 불명·종료 확인 실패·아직
// 시작 안 함을 다른 문구와 아이콘으로 보인다(shell/terminal#R9). 다시 시작은 자동이
// 아니다.
export function ExitBanner({ state, onRestart }: ExitBannerProps) {
  const mark = state.kind === "refused"
    ? { label: t(REFUSAL_KEY[state.reason]), tone: "critical" as const }
    : (() => {
      const { wording, tone } = endingWording(
        state.kind === "ended" ? state.ending : "not_started",
        state.kind === "ended" ? state.exitCode : null,
      );
      const label = wording.key === "terminal.status.exited"
        ? t(wording.key, wording.values)
        : t(wording.key);
      return { label, tone };
    })();
  const restartLabel = state.kind === "refused"
    ? t("terminal.button.try-again")
    : t("terminal.button.start-again");
  const ending = state.kind === "ended" ? state.ending : state.kind;
  return (
    <div
      className={styles.banner}
      data-exit-banner={ending}
      role="status"
    >
      <StatusMark tone={mark.tone} label={mark.label} />
      {onRestart
        ? (
          <Tooltip content={restartLabel}>
            <IconButton
              icon={retryIcon}
              label={restartLabel}
              size="sm"
              data-restart=""
              onClick={onRestart}
            />
          </Tooltip>
        )
        : null}
    </div>
  );
}

// 상한·단절로 빠진 출력이 있다는 표시(shell/terminal#R7).
export function MissingOutput() {
  return (
    <div className={styles.missing} data-output-missing="">
      <StatusMark tone="warning" label={t("terminal.status.output-missing")} />
    </div>
  );
}

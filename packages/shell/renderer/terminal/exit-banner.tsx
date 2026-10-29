import { Icon, IconButton } from "@lophn/ui/primitives";
import { StatusMark } from "@lophn/ui/feedback";
import { Tooltip } from "@lophn/ui/overlay";
import { iconPixels } from "@lophn/ui/shared";
import { retryIcon, workspaceIcons } from "../icons/mod.ts";
import { t } from "@lophn/wording";

import {
  type Ending,
  endingWording,
  type Refusal,
  REFUSAL_KEY,
} from "./model.ts";
import styles from "./terminal.module.css";

type BannerState =
  | { kind: "ended"; ending: Ending; exitCode: number | null }
  | { kind: "refused"; reason: Refusal };

interface ExitBannerProps {
  state: BannerState;
  /** 사람이 누를 때만 새 shell을 시작한다. 없으면 버튼을 두지 않는다. */
  onRestart?: () => void;
  /**
   * bar는 출력 아래 한 줄이고, center는 보일 출력이 없을 때 탭 가운데의 자리표시다.
   */
  variant?: "bar" | "center";
}

// 출력 옆의 상태 줄. 확인된 exit code·시작 실패·결과 불명·종료 확인 실패를 다른 문구와 아이콘으로 보인다.
// 끝난 shell을 다시 시작하는 것은 자동이 아니다(사람이 누른다).
export function ExitBanner({
  state,
  onRestart,
  variant = "bar",
}: ExitBannerProps) {
  const mark =
    state.kind === "refused"
      ? { label: t(REFUSAL_KEY[state.reason]), tone: "critical" as const }
      : (() => {
          const { wording, tone } = endingWording(state.ending, state.exitCode);
          const label =
            wording.key === "terminal.status.exited"
              ? t(wording.key, wording.values)
              : t(wording.key);
          return { label, tone };
        })();
  const restartLabel =
    state.kind === "refused"
      ? t("terminal.button.try-again")
      : t("terminal.button.start-again");
  const ending = state.kind === "ended" ? state.ending : state.kind;
  const restart = onRestart ? (
    <Tooltip content={restartLabel}>
      <IconButton
        icon={retryIcon}
        label={restartLabel}
        size={variant === "bar" ? "sm" : "md"}
        variant={variant === "bar" ? "ghost" : "secondary"}
        data-restart=""
        onClick={onRestart}
      />
    </Tooltip>
  ) : null;
  if (variant === "center") {
    return (
      <div className={styles.placeholderWrap}>
        <div
          className={styles.placeholder}
          data-exit-banner={ending}
          role="status"
        >
          <Icon
            icon={workspaceIcons.terminal}
            pixels={iconPixels("large")}
            className={styles.placeholderIcon}
          />
          <StatusMark tone={mark.tone} label={mark.label} />
          {restart}
        </div>
      </div>
    );
  }
  return (
    <div className={styles.banner} data-exit-banner={ending} role="status">
      <StatusMark tone={mark.tone} label={mark.label} />
      {restart}
    </div>
  );
}

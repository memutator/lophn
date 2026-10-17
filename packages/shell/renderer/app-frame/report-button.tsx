// [Report a problem] 깃발 단추. 앱 공간 바의 shell 크롬에 두고 그 자리의 실제 view(view_session)에 묶는다. 누르면 main이
// 버튼 시점 view를 고정하고 overlay에 dialog를 연다. 버튼은 shell renderer에 있어 앱 view가 crash·
// 무한 loop여도 동작한다. renderer는 view_session만 보내고 앱·release·화면은 main이 정한다.
import { useState } from "react";
import { Flag } from "lucide-react";
import { IconButton } from "@lophn/ui/primitives";
import { Tooltip } from "@lophn/ui/overlay";
import { t } from "@lophn/wording";

import type { LophnShellFeedbackBegin } from "../../ipc/feedback.ts";
import styles from "./report-button.module.css";

interface ReportButtonProps {
  feedback: LophnShellFeedbackBegin;
  /** 묶인 view. 아직 열리지 않았으면 null이고 버튼을 쓸 수 없다. */
  viewSession: string | null;
}

export function ReportButton({ feedback, viewSession }: ReportButtonProps) {
  const [failed, setFailed] = useState(false);
  const [opening, setOpening] = useState(false);

  async function open(): Promise<void> {
    if (viewSession === null || opening) return;
    setOpening(true);
    setFailed(false);
    try {
      await feedback.beginFeedback(viewSession);
    } catch (error) {
      // 이미 이 창에 dialog가 떠 있으면 그 dialog가 보인다.
      setFailed(!(error instanceof Error && error.message === "conflict"));
    } finally {
      setOpening(false);
    }
  }

  const label = t("report-problem.button.open");
  return (
    <span className={styles.report}>
      <Tooltip content={label}>
        <IconButton
          icon={Flag}
          label={label}
          disabled={viewSession === null}
          data-report-problem=""
          onClick={() => void open()}
        />
      </Tooltip>
      {failed
        ? (
          <span className={styles.failed} role="status">
            {t("report-problem.notice.open-failed")}
          </span>
        )
        : null}
    </span>
  );
}

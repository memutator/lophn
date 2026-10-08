import { useEffect, useRef, useState } from "react";
import { Button } from "@lophn/design/components";
import { t } from "@lophn/wording";

import type { OperatorSource, Proposed } from "./source.ts";
import styles from "../roles.module.css";

export type Finished = "attached" | "declined" | "failed";

export interface ApprovalWaitProps {
  source: OperatorSource;
  proposed: Proposed;
  /** 확인 간격(ms). 테스트가 짧게 고정한다. */
  pollMs?: number;
  onFinished: (outcome: Finished) => void;
}

// 보호 창에서 사람이 결정하는 동안 기다린다. 결정은 창에서만 하고 이 자리는 상태를 따라가기만 한다.
// 허락됐으면 source가 적용까지 한다. 거절·취소·만료는 아무것도 바뀌지 않은 채 끝난다.
export function ApprovalWait(
  { source, proposed, pollMs = 1500, onFinished }: ApprovalWaitProps,
) {
  const [checking, setChecking] = useState(false);
  const busy = useRef(false);
  const done = useRef(false);
  const finish = useRef(onFinished);
  finish.current = onFinished;

  const check = async () => {
    if (busy.current || done.current) return;
    busy.current = true;
    setChecking(true);
    const settled = await source.settle(proposed);
    busy.current = false;
    setChecking(false);
    if (done.current) return;
    if (!settled.ok) {
      // 아직 읽지 못했을 뿐이면 다음 확인을 기다린다. 허락 뒤 적용이 막히면 실패로 끝낸다.
      if (settled.code === "unavailable") return;
      done.current = true;
      finish.current("failed");
      return;
    }
    if (settled.value === "waiting") return;
    done.current = true;
    finish.current(settled.value);
  };

  useEffect(() => {
    done.current = false;
    void check();
    const timer = setInterval(() => void check(), pollMs);
    return () => {
      done.current = true;
      clearInterval(timer);
    };
  }, [source, proposed, pollMs]);

  return (
    <div className={styles.panel} data-approval-wait={proposed.approval}>
      <p className={styles.notice}>{t("roles.attach.waiting")}</p>
      <div className={styles.actions}>
        <Button
          size="sm"
          variant="secondary"
          data-action="attach-check"
          disabled={checking}
          onClick={() => void check()}
        >
          {t("roles.button.attach-check")}
        </Button>
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import { t } from "@lophn/wording";

import type { ConfirmationFrameApi, ConfirmationView } from "./frame/api.ts";
import { ConfirmationFrame } from "./frame/frame.tsx";
import { OwnerDecision } from "./kinds/owner-decision/owner-decision.tsx";

export interface ScreenProps {
  api: ConfirmationFrameApi;
  theme: Record<string, string>;
}

/**
 * 표시 자료가 있는 owner decision은 배치 화면으로, 나머지는 보호 틀로 그린다.
 * 제출·취소·Escape 처리는 보호 틀과 같다.
 */
export function ConfirmationScreen({ api, theme }: ScreenProps) {
  const [view, setView] = useState<ConfirmationView | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let gone = false;
    void api.getDisplay().then((next) => {
      if (!gone) setView(next);
    }).catch(() => {
      if (!gone) setFailed(true);
    });
    return () => {
      gone = true;
    };
  }, [api]);

  if (
    !failed && view !== null && view.request.kind === "owner_decision" &&
    view.step !== "stale"
  ) {
    return (
      <OwnerDecision
        view={view}
        onDecide={(decision) => {
          void api.submit({ displayId: view.displayId, decision });
        }}
        onCancel={() => void api.cancel()}
      />
    );
  }
  if (failed) {
    return <p>{t("confirmation-window.body.stale")}</p>;
  }
  return <ConfirmationFrame api={api} theme={theme} />;
}

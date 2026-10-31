// composer 아래 24px 한 줄. 마지막 요청이 창을 얼마나 썼는지, 이 session의 token과 금액을 늘 보이고 누르면 `/status` panel을
// 연다. omp의 하단 푸터와 같은 자리이고, 창을 80% 넘게 쓰면 경고색, 90%부터 위험색이다.

import { t } from "@lophn/i18n";
import type { ReactElement } from "react";
import type { StatusView as StatusData } from "../agent-tab-source.ts";
import styles from "./status-footer.module.css";
import {
  compactTokens,
  contextLevel,
  contextPercent,
  costText,
} from "./status-summary.ts";

interface StatusFooterProps {
  status: StatusData;
  onOpen: () => void;
}

export function StatusFooter({
  status,
  onOpen,
}: StatusFooterProps): ReactElement | null {
  const { context } = status;
  const percent = context === null ? null : contextPercent(context);
  const level = percent === null ? "normal" : contextLevel(percent);
  const tokens =
    status.inputTokens === null || status.outputTokens === null
      ? null
      : {
          input: compactTokens(
            status.inputTokens + (status.cacheReadTokens ?? 0),
          ),
          output: compactTokens(status.outputTokens),
        };
  const cost =
    status.costs.length === 0 ? null : status.costs.map(costText).join(" · ");
  // 아직 아무것도 모르는 새 session에는 줄을 두지 않는다.
  if (context === null && tokens === null && cost === null) return null;
  return (
    <button
      type="button"
      className={styles.footer}
      data-level={level}
      data-status-footer=""
      aria-label={t("conversation.label.status-of")}
      onClick={onOpen}
    >
      {percent === null || context === null ? null : (
        <>
          <span className={styles.bar} aria-hidden="true">
            <span
              className={styles.fill}
              style={{ width: `${Math.min(100, percent)}%` }}
            />
          </span>
          <span className={styles.context}>
            {t("conversation.label.status-footer-context", {
              percent,
              limit: compactTokens(context.limit),
            })}
          </span>
        </>
      )}
      {tokens === null ? null : (
        <span className={styles.detail}>
          {t("conversation.label.status-footer-tokens", tokens)}
        </span>
      )}
      {cost === null ? null : <span className={styles.detail}>{cost}</span>}
    </button>
  );
}

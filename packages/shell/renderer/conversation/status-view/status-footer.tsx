// composer 아래 줄(place·권한 옆 오른쪽 끝) 24px. 마지막 요청이 창을 얼마나 썼는지, 이 session의 token과 금액을 늘 보이고 누르면 `/status` panel을
// 연다. omp의 하단 푸터와 같은 자리이고, 창을 80% 넘게 쓰면 경고색, 90%부터 위험색이다.

import { t } from "@lophn/i18n";
import type { ReactElement } from "react";
import styles from "./status-footer.module.css";
import {
  compactTokens,
  contextLevel,
  contextPercent,
  costText,
  type StatusData,
} from "./status-summary.ts";

interface StatusFooterProps {
  status: StatusData;
  onOpen: () => void;
}

export function StatusFooter({
  status,
  onOpen,
}: StatusFooterProps): ReactElement | null {
  const { usage } = status;
  const { context } = usage;
  const percent = context === null ? null : contextPercent(context);
  const level = percent === null ? "normal" : contextLevel(percent);
  const tokens =
    usage.input_tokens === null || usage.output_tokens === null
      ? null
      : {
          input: compactTokens(
            usage.input_tokens +
              (usage.cache_read_tokens ?? 0) +
              (usage.cache_write_tokens ?? 0),
          ),
          output: compactTokens(usage.output_tokens),
        };
  // 값을 모르는 묶음은 panel이 보인다. 좁은 줄에는 아는 금액과 구독만 둔다.
  const known = usage.costs.filter(
    (cost) =>
      cost.kind === "subscription" ||
      cost.kind === "free" ||
      cost.amount !== null,
  );
  const cost = known.length === 0 ? null : known.map(costText).join(" · ");
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

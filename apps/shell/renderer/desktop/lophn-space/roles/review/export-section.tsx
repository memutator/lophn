import { useState } from "react";
import { Button, Checkbox } from "@lophn/design/components";
import { t } from "@lophn/wording";

import type { ContentKind, ExportResult, RolesSource } from "../source.ts";
import { Disclose } from "./disclose.tsx";
import styles from "../roles.module.css";

const KINDS: readonly {
  readonly kind: ContentKind;
  readonly label:
    | "roles.label.review-export-messages"
    | "roles.label.review-export-model-input"
    | "roles.label.review-export-model-output"
    | "roles.label.review-export-tool-input"
    | "roles.label.review-export-tool-output";
}[] = [
  { kind: "message", label: "roles.label.review-export-messages" },
  { kind: "model_input", label: "roles.label.review-export-model-input" },
  { kind: "model_output", label: "roles.label.review-export-model-output" },
  { kind: "tool_input", label: "roles.label.review-export-tool-input" },
  { kind: "tool_output", label: "roles.label.review-export-tool-output" },
];

type Outcome =
  | { readonly kind: "idle" }
  | { readonly kind: "cancelled" }
  | { readonly kind: "failed" }
  | { readonly kind: "done"; readonly result: ExportResult };

// 파일 export. 기본은 메타데이터뿐이고 export마다 포함할 내용 종류를 다시 고른다. 보낸 수와 못 보낸
// 수를 따로 보이고, 못 보낸 것이 있으면 성공으로 보이지 않는다(observability#R16, R17).
export function ExportSection(
  { source, work }: { source: RolesSource; work: string },
) {
  const [chosen, setChosen] = useState<readonly ContentKind[]>([]);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>({ kind: "idle" });

  const send = async () => {
    setBusy(true);
    const sent = await source.exportTrace(work, chosen);
    setBusy(false);
    setOutcome(
      !sent.ok
        ? { kind: "failed" }
        : sent.value === null
        ? { kind: "cancelled" }
        : { kind: "done", result: sent.value },
    );
  };

  return (
    <Disclose name="export" label={t("roles.label.review-export")}>
      <div className={styles.exportBox}>
        <p className={styles.text}>{t("roles.review.export-intro")}</p>
        <div className={styles.kinds}>
          {KINDS.map((item) => (
            <Checkbox
              key={item.kind}
              label={t(item.label)}
              checked={chosen.includes(item.kind)}
              onCheckedChange={(checked) =>
                setChosen((previous) =>
                  // 고른 종류는 늘 같은 순서로 보낸다.
                  KINDS.map((other) => other.kind).filter((kind) =>
                    kind === item.kind ? checked : previous.includes(kind)
                  )
                )}
            />
          ))}
        </div>
        <div className={styles.actions}>
          <Button
            size="sm"
            variant="secondary"
            data-action="export"
            disabled={busy}
            onClick={() => void send()}
          >
            {t("roles.button.export")}
          </Button>
        </div>
        {outcome.kind === "failed"
          ? (
            <p className={styles.problem} data-export="failed">
              {t("roles.review.export-failed")}
            </p>
          )
          : null}
        {outcome.kind === "cancelled"
          ? (
            <p className={styles.muted} data-export="cancelled">
              {t("roles.review.export-cancelled")}
            </p>
          )
          : null}
        {outcome.kind === "done"
          ? (
            <p
              className={outcome.result.notSent > 0
                ? styles.problem
                : styles.text}
              data-export="done"
            >
              {outcome.result.notSent > 0
                ? t("roles.review.export-partial", {
                  sent: outcome.result.sent,
                  notSent: outcome.result.notSent,
                })
                : t("roles.review.export-done", { sent: outcome.result.sent })}
            </p>
          )
          : null}
      </div>
    </Disclose>
  );
}

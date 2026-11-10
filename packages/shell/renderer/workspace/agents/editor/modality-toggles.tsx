// 받는 것(Takes)과 내는 것(Gives) 두 줄. 줄마다 text·image·file 토글이 오른쪽 고정 열에 있다.
// 셋 다 켠 쪽은 정의에서 뺀다: 파일에는 사람이 바꾼 칸만 둔다.
import { Button } from "@lophn/ui/primitives";
import { t } from "@lophn/i18n";

import type { Modality } from "../../../../../protocol/lophn-agent/agent-values.ts";
import { modalityIcons } from "../../../icons/mod.ts";
import { modalityLabel } from "../agent-card.tsx";
import type { AgentDraft } from "../source.ts";
import styles from "./agent-editor.module.css";

const ALL_MODALITIES: readonly Modality[] = ["text", "image", "file"];

function withModality(
  definition: AgentDraft,
  side: "input" | "output",
  mode: Modality,
  on: boolean,
): AgentDraft["modality"] {
  const current = (one: "input" | "output") =>
    definition.modality?.[one] ?? ALL_MODALITIES;
  const chosen = ALL_MODALITIES.filter((one) =>
    one === mode ? on : current(side).includes(one),
  );
  const next = { ...definition.modality, [side]: chosen };
  const input = next.input ?? ALL_MODALITIES;
  const output = next.output ?? ALL_MODALITIES;
  const full = (list: readonly Modality[]) => list.length === 3;
  if (full(input) && full(output)) return undefined;
  return {
    ...(full(input) ? {} : { input }),
    ...(full(output) ? {} : { output }),
  };
}

export function ModalityToggles({
  definition,
  onChange,
}: {
  definition: AgentDraft;
  onChange: (modality: AgentDraft["modality"]) => void;
}) {
  return (
    <div className={styles.modality}>
      {(["input", "output"] as const).map((side) => {
        const label =
          side === "input"
            ? t("agents.label.modality-input")
            : t("agents.label.modality-output");
        return (
          <div
            key={side}
            className={styles.modalityRow}
            data-modality={side}
            role="group"
            aria-label={label}
          >
            <span className={styles.modalityLabel}>{label}</span>
            <span className={styles.modalityToggles}>
              {ALL_MODALITIES.map((mode) => {
                const on = (
                  definition.modality?.[side] ?? ALL_MODALITIES
                ).includes(mode);
                return (
                  <Button
                    key={mode}
                    size="sm"
                    variant="ghost"
                    icon={modalityIcons[mode]}
                    aria-pressed={on}
                    onClick={() =>
                      onChange(withModality(definition, side, mode, !on))
                    }
                  >
                    {modalityLabel(mode)}
                  </Button>
                );
              })}
            </span>
          </div>
        );
      })}
    </div>
  );
}

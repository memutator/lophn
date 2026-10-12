// [Change]가 줄 아래에 여는 editor. 연결된 provider의 model 목록에서 하나를 고르고, 고른 model의 option 축을
// 고른다. 목록과 축은 catalog가 준 것을 받은 순서대로 그린다(lophn-agent/harness/model#R8·R21).
// 다른 model을 고르면 앞 model의 option 값은 버리고 새 model의 기본값으로 시작한다.
import { useState } from "react";
import type { KeyboardEvent } from "react";
import { Button } from "@lophn/design/components";
import { t } from "@lophn/wording";

import { defaultValues, modelLine, modelRows, optionsOf } from "./model.ts";
import type {
  AgentsSettingsView,
  ModelChoice,
  OptionAxisRow,
} from "./settings-source.ts";
import styles from "./agents.module.css";

export interface ModelEditorProps {
  view: AgentsSettingsView;
  /** 지금 이 칸의 값. 비어 있으면 null이다. */
  current: ModelChoice | null;
  busy: boolean;
  onSave: (choice: ModelChoice) => void;
  onCancel: () => void;
}

function sameModel(first: ModelChoice | null, provider: string, name: string) {
  return first !== null && first.provider === provider &&
    first.modelName === name;
}

function AxisChoice(
  { axis, value, onPick }: {
    axis: OptionAxisRow;
    value: string | undefined;
    onPick: (value: string) => void;
  },
) {
  // 화살표로 이웃 값을 고르고 focus도 따라간다(radio group의 roving tabindex).
  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown"
      ? 1
      : event.key === "ArrowLeft" || event.key === "ArrowUp"
      ? -1
      : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = axis.values[
      (index + step + axis.values.length) % axis.values.length
    ];
    onPick(next.value);
    const radios = event.currentTarget.parentElement?.querySelectorAll<
      HTMLButtonElement
    >("[role='radio']");
    radios?.[axis.values.indexOf(next)]?.focus();
  };
  const tabbable = axis.values.some((row) => row.value === value)
    ? value
    : axis.values[0]?.value;
  return (
    <div className={styles.axis}>
      <span className={styles.axisLabel}>{axis.label}</span>
      <div
        role="radiogroup"
        aria-label={axis.label}
        data-axis={axis.id}
        className={styles.radios}
      >
        {axis.values.map((row, index) => (
          <button
            key={row.value}
            type="button"
            role="radio"
            aria-checked={row.value === value}
            tabIndex={row.value === tabbable ? 0 : -1}
            data-value={row.value}
            className={styles.radio}
            onClick={() => onPick(row.value)}
            onKeyDown={(event) => move(event, index)}
          >
            {row.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ModelEditor(
  { view, current, busy, onSave, onCancel }: ModelEditorProps,
) {
  const rows = modelRows(view);
  // 열 때는 지금 값에서 시작하고, 기본값이 있는 축에 고른 값이 없으면 기본값을 골라 둔다.
  const [draft, setDraft] = useState<ModelChoice | null>(() => {
    if (current === null) return null;
    const options = optionsOf(view, current);
    return {
      ...current,
      optionValues: { ...defaultValues(options), ...current.optionValues },
    };
  });

  const pick = (provider: string, modelName: string) => {
    if (sameModel(draft, provider, modelName)) return;
    const options =
      rows.find((row) =>
        row.provider === provider && row.modelName === modelName
      )?.options ?? null;
    setDraft({ provider, modelName, optionValues: defaultValues(options) });
  };
  const options = draft === null ? null : optionsOf(view, draft);

  return (
    <div className={styles.editor} data-editor-body="">
      <div
        role="listbox"
        aria-label={t("settings.label.model-name")}
        className={styles.models}
      >
        {rows.map((row) => {
          const selected = sameModel(draft, row.provider, row.modelName);
          return (
            <div
              key={`${row.provider}/${row.modelName}`}
              role="option"
              tabIndex={0}
              aria-selected={selected}
              data-model-name={row.modelName}
              className={styles.model}
              onClick={() => pick(row.provider, row.modelName)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                pick(row.provider, row.modelName);
              }}
            >
              {modelLine(row.providerName, row.modelName)}
            </div>
          );
        })}
      </div>
      {draft === null
        ? null
        : options === null
        ? (
          <p className={styles.hint} data-options-unknown="">
            {t("settings.agents.options-unknown")}
          </p>
        )
        : options.length === 0
        ? (
          <p className={styles.hint} data-no-options="">
            {t("settings.agents.no-options")}
          </p>
        )
        : options.map((axis) => (
          <AxisChoice
            key={axis.id}
            axis={axis}
            value={draft.optionValues[axis.id]}
            onPick={(value) =>
              setDraft({
                ...draft,
                optionValues: { ...draft.optionValues, [axis.id]: value },
              })}
          />
        ))}
      <div className={styles.editorActions}>
        <Button
          size="sm"
          variant="primary"
          data-action="save"
          disabled={draft === null || busy}
          onClick={() => draft !== null && onSave(draft)}
        >
          {t("settings.button.save")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          data-action="cancel"
          onClick={onCancel}
        >
          {t("settings.button.cancel")}
        </Button>
      </div>
    </div>
  );
}

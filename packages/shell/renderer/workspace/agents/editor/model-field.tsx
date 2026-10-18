// Model 칸. conversation의 ModelField(상속 표시, Changed, Reset, option 축)를 catalog에서 만든 선택지와 값으로 감싼다.
// model 이름과 option 이름·값은 모두 catalog가 주고 화면 코드에는 없다.
import {
  VendorIcon,
  vendorOf,
} from "../../../parts/vendor-icon/vendor-icon.tsx";
import { Field, Select } from "@lophn/ui/input";
import { t } from "@lophn/wording";

import { optionAxesOf } from "../../../../../protocol/lophn-agent/model-picker.ts";
import type { ModelChoice } from "../../../../../protocol/lophn-agent/models.ts";
import {
  ModelField as ConversationModelField,
  OptionAxes,
} from "../../../conversation/model-picker/model-picker.tsx";
import type { ModelSelectionView } from "../../../conversation/model-picker/types.ts";
import { CustomModelInput } from "../../../conversation/model-picker/custom-model.tsx";
import { customProvidersOf, entryOf, modelsOf } from "../model-picker-data.ts";
import type { ModelsView } from "../source.ts";
import styles from "./agent-editor.module.css";

/** 선택지의 value. 같은 이름이 provider마다 있을 수 있어 둘을 이어 쓴다. */
const keyOf = (choice: { provider: string; model_name: string }) =>
  `${choice.provider}/${choice.model_name}`;

/**
 * 연결된 provider의 catalog에서 고를 수 있는 model. `chosen`은 지금 고른 값이다. 이름을 직접 적은 model처럼
 * catalog에 없어도 선택지에 남아야 칸이 비어 보이지 않는다.
 */
function choicesOf(
  models: ModelsView | null,
  chosen: readonly (ModelChoice | null)[] = [],
) {
  if (models === null) return [];
  const listed = models.providers.flatMap((provider) =>
    modelsOf(models, provider)
      .map((entry) => ({
        value: keyOf({ provider: provider.id, model_name: entry.model_name }),
        label: t("agents.label.model-by-provider", {
          model: entry.model_name,
          provider: provider.name,
        }),
        provider: provider.id,
        model_name: entry.model_name,
      }))
  );
  const extra = chosen.flatMap((choice) => {
    const provider = choice === null
      ? undefined
      : models.providers.find((item) => item.id === choice.provider);
    if (choice === null || provider === undefined) return [];
    const value = keyOf(choice);
    if (listed.some((item) => item.value === value)) return [];
    return [{
      value,
      label: t("agents.label.model-by-provider", {
        model: choice.model_name,
        provider: provider.name,
      }),
      provider: provider.id,
      model_name: choice.model_name,
    }];
  });
  return [
    ...listed,
    ...extra.filter((item, at) =>
      extra.findIndex((other) => other.value === item.value) === at
    ),
  ];
}

function selectionOf(
  models: ModelsView | null,
  choice: ModelChoice | null,
): ModelSelectionView {
  if (choice === null) return { model: "", axes: [], optionValues: {} };
  const entry = entryOf(
    models ?? { providers: [], catalog: [], favorites: [] },
    {
      provider: choice.provider,
      modelName: choice.model_name,
    },
  );
  return {
    model: keyOf(choice),
    axes: entry === undefined ? [] : optionAxesOf(entry).map((axis) => ({
      id: axis.id,
      label: axis.label,
      values: axis.values,
    })),
    optionValues: choice.option_values,
  };
}

/** 새로 고른 model의 option은 catalog의 기본값이다. */
function pick(models: ModelsView | null, key: string): ModelChoice | null {
  const found = choicesOf(models).find((item) => item.value === key);
  if (found === undefined) return null;
  const entry = entryOf(
    models ?? { providers: [], catalog: [], favorites: [] },
    {
      provider: found.provider,
      modelName: found.model_name,
    },
  );
  const optionValues: Record<string, string> = {};
  for (const axis of entry === undefined ? [] : optionAxesOf(entry)) {
    if (axis.default_value !== null) {
      optionValues[axis.id] = axis.default_value;
    }
  }
  return {
    provider: found.provider,
    model_name: found.model_name,
    option_values: optionValues,
  };
}

interface ModelFieldProps {
  readonly models: ModelsView | null;
  readonly label: string;
  /** "Use project default — Haiku 5.5 (from Workspace)" 같은 따르기 선택지의 글. */
  readonly inheritLabel: string;
  /** 따를 때의 값. 어느 층에도 없으면 null이다. */
  readonly inherited: ModelChoice | null;
  /** 이 칸에서 고른 값. 따르는 중이면 null이다. */
  readonly value: ModelChoice | null;
  readonly overrideNote?: string;
  readonly onChange: (choice: ModelChoice | null) => void;
}

export function ModelField(
  { models, label, inheritLabel, inherited, value, overrideNote, onChange }:
    ModelFieldProps,
) {
  const custom = {
    providers: customProvidersOf(models),
    onUse: (provider: string, modelName: string) =>
      onChange({ provider, model_name: modelName, option_values: {} }),
  };
  return (
    <>
      <ConversationModelField
        label={label}
        inheritLabel={inheritLabel}
        axesReady={models !== null}
        choices={choicesOf(models, [value])}
        inherited={selectionOf(models, inherited)}
        value={value === null ? null : selectionOf(models, value)}
        overrideNote={overrideNote}
        onChange={(key) => onChange(key === null ? null : pick(models, key))}
        onOptionChange={(axis, next) => {
          const base = value ?? inherited;
          if (base === null) return;
          onChange({
            ...base,
            option_values: { ...base.option_values, [axis]: next },
          });
        }}
      />
      <CustomModelInput custom={custom} />
    </>
  );
}

/** 고른 model의 provider를 vendor 아이콘과 함께 보인다. */
function ModelProvider({ name }: { name: string }) {
  const vendor = vendorOf(name);
  return (
    <p className={styles.modelProvider}>
      {t("agents.label.provider")}
      <span className={styles.vendorName}>
        {vendor === undefined ? null : <VendorIcon vendor={vendor} size={14} />}
        {name}
      </span>
    </p>
  );
}

interface DefaultModelFieldProps {
  readonly models: ModelsView | null;
  readonly value: ModelChoice | null;
  readonly onChange: (choice: ModelChoice) => void;
}

/** 위 층이 없는 model 칸(Workspace 전역 기본). model과 그 model의 option 축을 고른다. */
export function DefaultModelField(
  { models, value, onChange }: DefaultModelFieldProps,
) {
  const selection = selectionOf(models, value);
  const provider = value === null
    ? undefined
    : models?.providers.find((item) => item.id === value.provider);
  return (
    <div className={styles.group}>
      <Field label={t("project-workspace.heading.agent-editor-model")}>
        <Select
          options={choicesOf(models, [value])}
          value={selection.model === "" ? undefined : selection.model}
          placeholder={t("agents.label.no-model-chosen")}
          onValueChange={(key) => {
            const next = pick(models, key);
            if (next !== null) onChange(next);
          }}
        />
      </Field>
      {provider === undefined ? null : <ModelProvider name={provider.name} />}
      {value === null || models === null ? null : (
        <OptionAxes
          selection={selection}
          onChange={(axis, next) => {
            onChange({
              ...value,
              option_values: { ...value.option_values, [axis]: next },
            });
          }}
        />
      )}
      <CustomModelInput
        custom={{
          providers: customProvidersOf(models),
          onUse: (provider, modelName) =>
            onChange({ provider, model_name: modelName, option_values: {} }),
        }}
      />
    </div>
  );
}

// Settings › Agents가 고른 model을 글로 만드는 계산. model 이름·option 이름과 값은 모두 catalog가
// 주는 말이고 이 모듈에는 없다. 연결 이름을 못 찾으면(연결을 지운 뒤) 그렇게 알린다.
import { t } from "@lophn/wording";

import type {
  AgentsSettingsView,
  CatalogModel,
  ModelChoice,
  OptionAxisRow,
} from "./settings-source.ts";

/** editor가 보이는 model 한 줄. 연결된 provider의 model만 있다. */
export interface ModelRow {
  readonly provider: string;
  readonly providerName: string;
  readonly modelName: string;
  readonly options: readonly OptionAxisRow[] | null;
}

export function providerName(view: AgentsSettingsView, id: string): string {
  return view.providers.find((row) => row.id === id)?.name ??
    t("settings.label.unavailable-connection");
}

/** 고를 수 있는 model. 연결 순서, 그 안에서 catalog 순서다. */
export function modelRows(view: AgentsSettingsView): ModelRow[] {
  return view.providers.flatMap((provider) =>
    view.catalog
      .filter((entry) => entry.providerDefinition === provider.definition)
      .map((entry) => ({
        provider: provider.id,
        providerName: provider.name,
        modelName: entry.modelName,
        options: entry.options,
      }))
  );
}

export function modelLine(connection: string, modelName: string): string {
  return t("settings.label.model-line", { name: connection, model: modelName });
}

function entryOf(
  view: AgentsSettingsView,
  choice: ModelChoice,
): CatalogModel | undefined {
  const definition = view.providers.find((row) => row.id === choice.provider)
    ?.definition;
  return view.catalog.find((entry) =>
    entry.providerDefinition === definition &&
    entry.modelName === choice.modelName
  );
}

/** 고른 model이 가진 축. catalog가 모르는 model이면 null이다(option을 모른다). */
export function optionsOf(
  view: AgentsSettingsView,
  choice: ModelChoice,
): readonly OptionAxisRow[] | null {
  return entryOf(view, choice)?.options ?? null;
}

/** "Effort: High · Speed: Standard". 고른 값이 없거나 catalog가 모르는 축은 뺀다. 없으면 null이다. */
export function optionsLine(
  view: AgentsSettingsView,
  choice: ModelChoice,
): string | null {
  const parts: string[] = [];
  for (const axis of optionsOf(view, choice) ?? []) {
    const value = choice.optionValues[axis.id];
    const label = axis.values.find((row) => row.value === value)?.label;
    if (label !== undefined) {
      parts.push(
        t("settings.label.option-pair", { axis: axis.label, value: label }),
      );
    }
  }
  return parts.length === 0 ? null : parts.join(" · ");
}

/** 새로 고른 model의 option 값. 기본값이 있는 축만 채우고 나머지는 모델에 맡긴다. */
export function defaultValues(
  options: readonly OptionAxisRow[] | null,
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const axis of options ?? []) {
    if (axis.defaultValue !== null) values[axis.id] = axis.defaultValue;
  }
  return values;
}

// model 고르기의 규칙. catalog data(models-data.ts)만 읽고, model 이름으로 갈라지지 않는다.
import {
  type CatalogModel,
  MODEL_CATALOG,
  type OptionAxis,
} from "./models-data.ts";

/** 고른 model과 그 model의 option 값(축 id → 값). */
export interface ModelSelection {
  readonly model: string;
  readonly values: Readonly<Record<string, string>>;
}

function findModel(name: string): CatalogModel | undefined {
  for (const group of MODEL_CATALOG) {
    const found = group.models.find((model) => model.name === name);
    if (found) return found;
  }
  return undefined;
}

export function providerOf(name: string): string {
  return MODEL_CATALOG.find((group) =>
    group.models.some((model) => model.name === name)
  )?.provider ?? "";
}

export function axesOf(name: string): readonly OptionAxis[] {
  return findModel(name)?.options ?? [];
}

/** model을 처음 고를 때의 값. */
export function initialSelection(name: string): ModelSelection {
  const values: Record<string, string> = {};
  for (const axis of axesOf(name)) values[axis.id] = axis.initial;
  return { model: name, values };
}

/** 이름 뒤에 값을 이어 붙인 한 줄(`GPT-6.1 Sol · High · Priority`). 보통 값(quiet)은 붙이지 않는다. */
export function selectionLabel(selection: ModelSelection): string {
  const parts = [selection.model];
  for (const axis of axesOf(selection.model)) {
    const value = selection.values[axis.id];
    if (value !== undefined && value !== axis.quiet) parts.push(value);
  }
  return parts.join(" · ");
}

/** 축 하나의 값을 바꾼 selection. */
export function withValue(
  selection: ModelSelection,
  axis: string,
  value: string,
): ModelSelection {
  return { ...selection, values: { ...selection.values, [axis]: value } };
}

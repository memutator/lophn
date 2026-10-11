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

export function findModel(name: string): CatalogModel | undefined {
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

/**
 * model을 바꾼다. 같은 축에 지금 값이 없으면 가까운 약한 값(같은 센 정도 이하 중 가장 센 것, 없으면 가장 약한
 * 것)으로 맞추고 한 줄 알림을 돌려준다. 새 model에 없는 축은 버린다.
 */
export function switchModel(
  from: ModelSelection,
  name: string,
): { selection: ModelSelection; notes: readonly string[] } {
  const values: Record<string, string> = {};
  const notes: string[] = [];
  const oldAxes = axesOf(from.model);
  for (const axis of axesOf(name)) {
    const wanted = from.values[axis.id];
    if (wanted === undefined) {
      values[axis.id] = axis.initial;
      continue;
    }
    if (axis.values.some((item) => item.value === wanted)) {
      values[axis.id] = wanted;
      continue;
    }
    const rank = oldAxes
      .find((item) => item.id === axis.id)
      ?.values.find((item) => item.value === wanted)?.rank ?? 0;
    const weaker = axis.values.filter((item) => item.rank <= rank);
    const pick = weaker.length > 0
      ? weaker.reduce((best, item) => item.rank > best.rank ? item : best)
      : axis.values.reduce((best, item) => item.rank < best.rank ? item : best);
    values[axis.id] = pick.value;
    notes.push(
      `${axis.label} set to ${pick.value} — ${wanted} isn't available for ${name}.`,
    );
  }
  return { selection: { model: name, values }, notes };
}

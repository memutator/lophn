// model picker가 그릴 값을 catalog에서 만든다(shell/workspace#R37·R41). 정렬·거르기·값 맞춤은 contracts의
// model-picker 규칙이 하고, 여기는 그 결과를 picker component의 props 모양으로 옮기고 고른 값을 ModelChoice로
// 돌려주는 연결만 한다. model 이름과 option 이름·값은 모두 catalog가 주고 화면 코드에는 없다.
import { t } from "@lophn/wording";

import type { ModelChoice } from "../../../../../packages/contracts/lophn-agent/models.ts";
import {
  fitOptionValues,
  optionAxesOf,
  orderPicker,
  toggleFavorite,
} from "../../../../../packages/contracts/lophn-agent/model-picker.ts";
import type {
  ModelPickerProps,
  PickerAxisView,
  PickerModelRef,
  PickerModelRow,
  PickerNoticeView,
} from "../../conversation/model-picker/model-picker.tsx";
import type { ModelFavorite, ModelsView } from "./source.ts";
import type { ModelLabel } from "./views.ts";

/** picker 하나가 가진 화면 상태. 닫혀 있고 검색이 비어 있는 것이 처음이다. */
export interface PickerState {
  readonly open: boolean;
  readonly query: string;
  /** 방금 model을 바꾸며 맞춘 값. */
  readonly notices: readonly PickerNoticeView[];
}

export const CLOSED_PICKER: PickerState = {
  open: false,
  query: "",
  notices: [],
};

function entryOf(models: ModelsView, model: PickerModelRef) {
  const provider = models.providers.find((item) => item.id === model.provider);
  return provider === undefined
    ? undefined
    : models.catalog.find((entry) =>
      entry.provider_definition === provider.definition &&
      entry.model_name === model.modelName
    );
}

/** "Sonnet 5.5 · Medium": model 이름 뒤에 값이 있는 축의 표시 이름을 catalog가 준 순서대로 잇는다. */
export function modelLabelOf(models: ModelsView | null): ModelLabel {
  return (choice) => {
    const entry = models === null ? undefined : entryOf(models, {
      provider: choice.provider,
      modelName: choice.model_name,
    });
    const values = entry === undefined ? [] : optionAxesOf(entry).flatMap(
      (axis) => {
        const chosen = axis.values.find((item) =>
          item.value === choice.option_values[axis.id]
        );
        return chosen === undefined ? [] : [chosen.label];
      },
    );
    return [choice.model_name, ...values].join(" · ");
  };
}

export interface PickerBinding {
  readonly models: ModelsView | null;
  readonly state: PickerState;
  readonly setState: (state: PickerState) => void;
  /** 이 칸의 지금 model(고른 값 또는 상속하는 값). 어디에도 없으면 null이다. */
  readonly current: ModelChoice | null;
  /** 새로 고른 값. */
  readonly choose: (choice: ModelChoice) => void;
  readonly setFavorites: (items: readonly ModelFavorite[]) => void;
  /** "Change defaults…". */
  readonly changeDefaults: () => void;
}

const NONE: PickerModelRef = { provider: "", modelName: "" };

function axesOf(
  models: ModelsView | null,
  current: ModelChoice | null,
): readonly PickerAxisView[] {
  if (models === null || current === null) return [];
  const entry = entryOf(models, {
    provider: current.provider,
    modelName: current.model_name,
  });
  return entry === undefined ? [] : optionAxesOf(entry).map((axis) => ({
    id: axis.id,
    label: axis.label,
    values: axis.values,
  }));
}

export function pickerProps(binding: PickerBinding): ModelPickerProps {
  const { models, state, current } = binding;
  const providers = models?.providers ?? [];
  const favorites = models?.favorites ?? [];
  const available = providers.flatMap((provider) =>
    (models?.catalog ?? [])
      .filter((entry) => entry.provider_definition === provider.definition)
      .map((entry) => ({
        provider: provider.id,
        model_name: entry.model_name,
      }))
  );
  const layout = orderPicker({
    favorites,
    models: available,
    query: state.query,
  });
  const nameOf = (id: string) =>
    providers.find((provider) => provider.id === id)?.name ?? id;
  const starred = (model: { provider: string; model_name: string }) =>
    favorites.some((item) =>
      item.provider === model.provider && item.model_name === model.model_name
    );
  const row = (
    model: { provider: string; model_name: string },
  ): PickerModelRow => ({
    provider: model.provider,
    providerLabel: nameOf(model.provider),
    modelName: model.model_name,
    starred: starred(model),
  });
  const label = modelLabelOf(models);
  const choiceOf = (model: PickerModelRef): ModelChoice => {
    const entry = models === null ? undefined : entryOf(models, model);
    return {
      provider: model.provider,
      model_name: model.modelName,
      option_values: entry === undefined
        ? {}
        : fitOptionValues(entry, current?.option_values ?? {}).option_values,
    };
  };
  return {
    open: state.open,
    onOpenChange: (open) => binding.setState({ ...state, open }),
    current: current === null
      ? NONE
      : { provider: current.provider, modelName: current.model_name },
    currentLabel: current === null
      ? t("project-workspace.label.agent-no-model")
      : label(current),
    axes: axesOf(models, current),
    optionValues: current?.option_values ?? {},
    query: state.query,
    layout: {
      favorites: layout.favorites.map((model) => ({
        ...row(model),
        starred: true,
      })),
      providers: layout.providers.map((group) => ({
        provider: group.provider,
        label: nameOf(group.provider),
        models: group.models.map(row),
      })),
    },
    notices: state.notices,
    onQueryChange: (query) => binding.setState({ ...state, query }),
    onPick: (model) => {
      const next = choiceOf(model);
      const entry = models === null ? undefined : entryOf(models, model);
      const before = current === null || models === null
        ? undefined
        : entryOf(models, {
          provider: current.provider,
          modelName: current.model_name,
        });
      const fitted = entry === undefined
        ? []
        : fitOptionValues(entry, current?.option_values ?? {}).notices;
      const labelOf = (
        axes: readonly PickerAxisView[],
        id: string,
        value: string,
      ) =>
        axes.find((axis) => axis.id === id)?.values.find((item) =>
          item.value === value
        )?.label ?? value;
      const nextAxes = entry === undefined ? [] : optionAxesOf(entry);
      const beforeAxes = before === undefined ? [] : optionAxesOf(before);
      binding.setState({
        ...state,
        notices: fitted.map((notice) => ({
          axisLabel: nextAxes.find((axis) => axis.id === notice.axis)?.label ??
            notice.axis,
          fromLabel: labelOf(beforeAxes, notice.axis, notice.from),
          toLabel: labelOf(nextAxes, notice.axis, notice.to),
        })),
      });
      binding.choose(next);
    },
    onToggleFavorite: (model) =>
      binding.setFavorites(
        toggleFavorite(
          favorites.map((item) => ({
            provider: item.provider,
            model_name: item.model_name,
          })),
          { provider: model.provider, model_name: model.modelName },
        ),
      ),
    onOptionChange: (axis, value) => {
      if (current === null) return;
      binding.choose({
        ...current,
        option_values: { ...current.option_values, [axis]: value },
      });
    },
    onChangeDefaults: binding.changeDefaults,
  };
}

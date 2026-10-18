// model picker가 그릴 값을 catalog에서 만든다. 정렬·거르기·값 맞춤은 protocol의
// model-picker 규칙이 하고, 여기는 그 결과를 picker component의 props 모양으로 옮기고 고른 값을 ModelChoice로
// 돌려주는 연결만 한다. model 이름과 option 이름·값은 모두 catalog가 주고 화면 코드에는 없다.
import { t } from "@lophn/wording";

import type { AgentValueLayer } from "../../../../protocol/lophn-agent/agent-definitions.ts";
import type {
  CatalogEntry,
  ModelChoice,
} from "../../../../protocol/lophn-agent/models.ts";
import {
  fitOptionValues,
  optionAxesOf,
  orderPicker,
  type SelectableModel,
  selectableModels,
  toggleFavorite,
  typedNameAllowed,
} from "../../../../protocol/lophn-agent/model-picker.ts";
import type {
  ModelPickerProps,
  PickerAxisView,
  PickerModelRef,
  PickerModelRow,
} from "../../conversation/model-picker/types.ts";
import type { ModelFavorite, ModelsView, ProviderChoice } from "./source.ts";
import type { ModelLabel } from "./views.ts";

/** picker 하나가 가진 화면 상태. 닫혀 있고 검색이 비어 있는 것이 처음이다. */
interface PickerState {
  readonly open: boolean;
  readonly query: string;
}

/** 그 provider에서 고를 수 있는 model. 어느 것을 고를 수 있는지는 protocol의 selectableModels가 정한다. 고른 model을 찾는 entryOf는 거르지 않는다. */
export function modelsOf(
  models: ModelsView,
  provider: ProviderChoice,
): SelectableModel[] {
  return selectableModels({
    definition: provider.definition,
    catalog: models.catalog,
    reported: provider.reportedModels,
  });
}

/** catalog에 그 정의의 model이 하나도 없는 provider(custom). catalog를 읽지 못했으면(비었으면) 모든 provider가 그렇게 보이므로 아니라고 말한다. */
export function isCustomDefinition(
  catalog: readonly CatalogEntry[],
  definition: string,
) {
  return catalog.length > 0 &&
    !catalog.some((entry) => entry.provider_definition === definition);
}

/** core의 provider 한 줄을 화면이 쓰는 ProviderChoice로 옮긴다. */
export function providerChoiceOf(
  provider: {
    id: string;
    name: string;
    definition: { key: string };
    credential: { kind: string; reported_models: readonly string[] | null };
  },
  catalog: readonly CatalogEntry[],
): ProviderChoice {
  return {
    id: provider.id,
    name: provider.name,
    definition: provider.definition.key,
    kind: provider.credential.kind,
    reportedModels: provider.credential.reported_models,
    refreshable: isCustomDefinition(catalog, provider.definition.key),
  };
}

export function entryOf(models: ModelsView, model: PickerModelRef) {
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
  /** 지금 model이 온 층. 알 수 없으면 null이다. */
  readonly layer: AgentValueLayer | null;
  /** 새로 고른 값. */
  readonly choose: (choice: ModelChoice) => void;
  readonly setFavorites: (items: readonly ModelFavorite[]) => void;
  /** custom provider의 model 목록을 다시 읽는다. 성공하면 true다. */
  readonly refreshModels: (provider: string) => Promise<boolean>;
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
  const available = models === null
    ? []
    : providers.flatMap((provider) =>
      modelsOf(models, provider).map((entry) => ({
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
  const refreshable = (provider: string) =>
    providers.find((item) => item.id === provider)?.refreshable ?? false;
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
      providers: [
        ...layout.providers.map((group) => ({
          provider: group.provider,
          label: nameOf(group.provider),
          models: group.models.map(row),
          refreshable: refreshable(group.provider),
        })),
        // 목록을 아직 읽지 못한 custom provider도 묶음 머리가 있어야 [Refresh models]가 보인다. 검색 중에는 숨긴다.
        ...(state.query.trim() !== ""
          ? []
          : providers.filter((provider) =>
            provider.refreshable &&
            !layout.providers.some((group) => group.provider === provider.id)
          ).map((provider) => ({
            provider: provider.id,
            label: provider.name,
            models: [],
            refreshable: true,
          }))),
      ],
    },
    onQueryChange: (query) => binding.setState({ ...state, query }),
    onPick: (model) => binding.choose(choiceOf(model)),
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
    typed: {
      providers: providers.filter((provider) =>
        typedNameAllowed(provider.kind, provider.reportedModels)
      ).map((provider) => ({ id: provider.id, name: provider.name })),
      onUse: (provider, modelName) =>
        binding.choose(choiceOf({ provider, modelName })),
    },
    layer: binding.layer,
    onRefreshModels: binding.refreshModels,
    onChangeDefaults: binding.changeDefaults,
  };
}

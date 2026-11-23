// model picker가 그릴 값을 catalog에서 만든다. 정렬·거르기·값 맞춤은 protocol의
// model-picker 규칙이 하고, 여기는 그 결과를 picker component의 props 모양으로 옮기고 고른 값을 ModelChoice로
// 돌려주는 연결만 한다. model 이름과 option 이름·값은 모두 catalog가 주고 화면 코드에는 없다.
import { t } from "@lophn/i18n";

import type { HarnessCatalogResult } from "../../../../protocol/acp/gui-session.ts";
import type {
  AcpModel,
  AcpModelAxis,
} from "../../../../protocol/acp/session.ts";
import type { AgentValueLayer } from "../../../../protocol/lophn-agent/agent-definitions.ts";
import type { HarnessConfig } from "../../../../protocol/lophn-agent/agent-values.ts";
import type {
  CatalogEntry,
  ModelChoice,
  UserModelRecord,
} from "../../../../protocol/lophn-agent/models.ts";
import {
  builtinListsModels,
  fitOptionValues,
  optionAxesOf,
  orderPicker,
  providerModelLimits,
  type SelectableModel,
  selectableModels,
} from "../../../../protocol/lophn-agent/model-picker.ts";
import type { ProviderRecord } from "../../../../protocol/lophn-agent/provider-values.ts";
import type {
  ManageProviderView,
  ModelPickerProps,
  PickerAxisView,
  PickerModelRef,
} from "../../conversation/model-picker/types.ts";
import type {
  EffectiveModelLimits,
  ModelsView,
  ProviderChoice,
  UserModels,
} from "./source.ts";
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

/**
 * core의 provider 한 줄을 화면이 쓰는 ProviderChoice로 옮긴다. custom인지는 내장 정의 목록(core의 `providers/definitions`)이
 * 정한다: catalog에 model이 있는지와 무관하므로 사람이 적은 override가 내장 provider를 custom으로 오해하지 않는다.
 * model마다 그 provider가 적용하는 한도를 같이 센다. 사람이 적은 한도(예: Codex에 적은 922000)를 알려면 그 model의
 * 저장된 정보를 함께 넘겨야 한다: catalog 항목만으로는 적은 값과 물려받은 값을 구별할 수 없다.
 */
export function providerChoiceOf(
  provider: ProviderRecord,
  catalog: readonly CatalogEntry[],
  builtin: Readonly<Record<string, true>>,
  userItems: readonly UserModelRecord[],
): ProviderChoice {
  const custom = builtin[provider.definition.key] !== true;
  const limits: Record<string, EffectiveModelLimits> = {};
  const seen: Record<string, true> = {};
  const names = [
    ...catalog
      .filter((entry) => entry.provider_definition === provider.definition.key)
      .map((entry) => entry.model_name),
    ...(provider.credential.reported_models ?? []),
    ...userItems
      .filter((item) => item.provider_definition === provider.definition.key)
      .map((item) => item.model_name),
  ];
  for (const modelName of names) {
    if (seen[modelName] === true) continue;
    seen[modelName] = true;
    // catalog 항목의 한도는 product catalog의 기본값이다. 사람이 적은 항목(user)보다 그것을 먼저 본다.
    const entry =
      catalog.find(
        (candidate) =>
          candidate.source !== "user" &&
          candidate.provider_definition === provider.definition.key &&
          candidate.model_name === modelName,
      ) ??
      catalog.find(
        (candidate) =>
          candidate.provider_definition === provider.definition.key &&
          candidate.model_name === modelName,
      ) ??
      null;
    const info =
      userItems.find(
        (item) =>
          item.provider_definition === provider.definition.key &&
          item.model_name === modelName,
      )?.info ?? null;
    const value = providerModelLimits(provider, modelName, entry, info);
    if (value !== null) limits[modelName] = value;
  }
  return {
    id: provider.id,
    name: provider.name,
    definition: provider.definition.key,
    kind: provider.credential.kind,
    reportedModels: provider.credential.reported_models,
    refreshable:
      custom ||
      builtinListsModels(provider.definition.key, provider.credential.kind),
    custom,
    limits,
  };
}

export function entryOf(models: ModelsView, model: PickerModelRef) {
  const provider = models.providers.find((item) => item.id === model.provider);
  return provider === undefined
    ? undefined
    : models.catalog.find(
        (entry) =>
          entry.provider_definition === provider.definition &&
          entry.model_name === model.modelName,
      );
}

/** "Sonnet 5.5 · Medium": model 이름 뒤에 값이 있는 축의 표시 이름을 catalog가 준 순서대로 잇는다. */
export function modelLabelOf(models: ModelsView | null): ModelLabel {
  return (choice) => {
    const entry =
      models === null
        ? undefined
        : entryOf(models, {
            provider: choice.provider,
            modelName: choice.model_name,
          });
    const values =
      entry === undefined
        ? []
        : optionAxesOf(entry).flatMap((axis) => {
            const chosen = axis.values.find(
              (item) => item.value === choice.option_values[axis.id],
            );
            return chosen === undefined ? [] : [chosen.label];
          });
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
  /** 켠 목록과 상관없이 고를 수 있는 model 전부를 보인다. 방금 연결해 아직 켠 model이 없을 때 쓴다. */
  readonly showAll?: boolean;
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
  return entry === undefined
    ? []
    : optionAxesOf(entry).map((axis) => ({
        id: axis.id,
        label: axis.label,
        values: axis.values,
      }));
}

export function pickerProps(binding: PickerBinding): ModelPickerProps {
  const { models, state, current } = binding;
  const providers = models?.providers ?? [];
  const available =
    models === null
      ? []
      : providers.flatMap((provider) =>
          modelsOf(models, provider).map((entry) => ({
            provider: provider.id,
            model_name: entry.model_name,
          })),
        );
  const layout = orderPicker({
    shown: binding.showAll ? available : (models?.shown ?? []),
    models: available,
    current:
      current === null
        ? null
        : { provider: current.provider, model_name: current.model_name },
    query: state.query,
  });
  const nameOf = (id: string) =>
    providers.find((provider) => provider.id === id)?.name ?? id;
  const choiceOf = (model: PickerModelRef): ModelChoice => {
    const entry = models === null ? undefined : entryOf(models, model);
    return {
      provider: model.provider,
      model_name: model.modelName,
      option_values:
        entry === undefined
          ? {}
          : fitOptionValues(entry, current?.option_values ?? {}).option_values,
    };
  };
  return {
    open: state.open,
    onOpenChange: (open) => binding.setState({ ...state, open }),
    current:
      current === null
        ? NONE
        : { provider: current.provider, modelName: current.model_name },
    // 단추가 값이 있는 축의 이름을 뒤에 붙이므로 여기는 model 이름만 준다.
    currentLabel:
      current === null
        ? t("project-workspace.label.agent-no-model")
        : current.model_name,
    axes: axesOf(models, current),
    optionValues: current?.option_values ?? {},
    query: state.query,
    layout: {
      providers: layout.providers.map((group) => ({
        provider: group.provider,
        label: nameOf(group.provider),
        models: group.models.map((model) => ({
          provider: model.provider,
          modelName: model.model_name,
        })),
      })),
    },
    onQueryChange: (query) => binding.setState({ ...state, query }),
    onPick: (model) => binding.choose(choiceOf(model)),
    onOptionChange: (axis, value) => {
      if (current === null) return;
      binding.choose({
        ...current,
        option_values: { ...current.option_values, [axis]: value },
      });
    },
    layer: binding.layer,
  };
}

/**
 * Manage models 창에 보일 provider 묶음. 연결된 provider마다 고를 수 있는 model(selectableModels)과 켠 여부, 입력 media,
 * 실제로 쓰는 context 한도, 사람이 적은 정보를 싣는다. `first`(방금 연결한 provider)가 있으면 그 묶음이 맨 위다.
 */
export function manageProviders(
  models: ModelsView,
  user: UserModels,
  first: string | null,
): ManageProviderView[] {
  const shown = new Set(
    models.shown.map((item) =>
      JSON.stringify([item.provider, item.model_name]),
    ),
  );
  const views = models.providers.map(
    (provider): ManageProviderView => ({
      id: provider.id,
      name: provider.name,
      models: modelsOf(models, provider).map((selectable) => {
        const info =
          user.items.find(
            (item) =>
              item.provider_definition === provider.definition &&
              item.model_name === selectable.model_name,
          )?.info ?? null;
        return {
          modelName: selectable.model_name,
          shown: shown.has(
            JSON.stringify([provider.id, selectable.model_name]),
          ),
          inputMedia: selectable.entry?.input_media ?? null,
          // 사람이 적은 값 → provider가 적용하는 값(Codex의 운영 window) → catalog 순서다.
          contextLimit:
            info?.context_limit ??
            provider.limits[selectable.model_name]?.context_limit ??
            selectable.entry?.context_limit ??
            null,
          info,
        };
      }),
      refreshable: provider.refreshable,
      custom: provider.custom,
    }),
  );
  return [
    ...views.filter((view) => view.id === first),
    ...views.filter((view) => view.id !== first),
  ];
}

// ---- harness model picker & summary ----

function switchAxisName(axis: AcpModelAxis): string {
  const on = axis.values[1]?.label;
  return on === undefined || on.trim().toLowerCase() === "on" ? axis.label : on;
}

function acpAxisView(axis: AcpModelAxis): PickerAxisView {
  return axis.kind === "switch"
    ? { ...axis, label: switchAxisName(axis) }
    : axis;
}

function capitalizeWord(word: string): string {
  return word.length === 0 ? "" : word[0]!.toUpperCase() + word.slice(1);
}

/** harness_config.options를 카드 앞면·Overview에서 읽기 좋은 조각들로 바꾼다("High", "XHigh", "Fast"). */
export function formatHarnessOptions(
  options: Readonly<Record<string, string>> | undefined,
): string[] {
  if (options === undefined) return [];
  const entries = Object.entries(options)
    .filter(([key, value]) => key.trim() !== "" && value.trim() !== "")
    .sort(([a], [b]) =>
      a === "effort" ? -1 : b === "effort" ? 1 : a.localeCompare(b),
    );
  const parts: string[] = [];
  for (const [axis, raw] of entries) {
    const lower = raw.trim().toLowerCase();
    if (lower === "very_high" || lower === "xhigh") {
      parts.push("XHigh");
      continue;
    }
    if (lower === "on" || lower === "true") {
      parts.push(capitalizeWord(axis.replaceAll("_", " ")));
      continue;
    }
    if (lower === "off" || lower === "false") {
      if (axis === "effort" || axis === "thinking") parts.push("Off");
      continue;
    }
    parts.push(capitalizeWord(raw.trim().replaceAll("_", " ")));
  }
  return parts;
}

/** harness_config를 "gpt-5.3-codex · High" 모양으로 잇는다. model이 없으면 null이다. */
export function formatHarnessModel(
  config:
    | {
        readonly model?: string;
        readonly options?: Readonly<Record<string, string>>;
      }
    | undefined,
): string | null {
  if (config?.model === undefined || config.model.trim() === "") return null;
  return [config.model, ...formatHarnessOptions(config.options)].join(" · ");
}

/** 빈 option을 뺀 HarnessConfig를 만든다. */
export function cleanHarnessConfig(
  model: string,
  options?: Readonly<Record<string, string>>,
): HarnessConfig {
  const cleaned: Record<string, string> = {};
  if (options !== undefined) {
    for (const [key, value] of Object.entries(options)) {
      if (key.trim() !== "" && value.trim() !== "") {
        cleaned[key] = value;
      }
    }
  }
  return Object.keys(cleaned).length === 0
    ? { model }
    : { model, options: cleaned };
}

function carryHarnessOptions(
  target: AcpModel,
  previous: Readonly<Record<string, string>> | undefined,
): Record<string, string> {
  if (previous === undefined) return {};
  const next: Record<string, string> = {};
  for (const axis of target.axes) {
    const prev = previous[axis.id];
    if (prev !== undefined && axis.values.some((item) => item.value === prev)) {
      next[axis.id] = prev;
    }
  }
  return next;
}

export interface HarnessPickerBinding {
  readonly catalog: HarnessCatalogResult | null;
  readonly state: PickerState;
  readonly setState: (state: PickerState) => void;
  readonly value: HarnessConfig | undefined;
  readonly followLabel: string;
  readonly onChange: (next: HarnessConfig | undefined) => void;
}

/**
 * harness catalog(`AcpModelGroup[]`)을 대화·lophn과 같은 `ModelPickerProps`로 옮긴다.
 * catalog가 없거나 저장된 model이 목록에 없어도 저장된 model 이름을 그대로 유지하고 `matched: false`로 알린다.
 */
export function harnessPickerProps(binding: HarnessPickerBinding): {
  readonly props: ModelPickerProps;
  readonly matched: boolean;
  readonly defaultModelLabel: string | null;
} {
  const { catalog, state, value, onChange } = binding;
  const groups = catalog?.models ?? [];
  const findModel = (id: string) => {
    for (const group of groups) {
      const model = group.models.find((one) => one.id === id);
      if (model !== undefined) return { group, model };
    }
    return undefined;
  };
  const chosenId = value?.model;
  const found = chosenId === undefined ? undefined : findModel(chosenId);
  const defaultId = catalog?.defaults.model ?? null;
  const defaultModelLabel =
    defaultId === null
      ? null
      : (findModel(defaultId)?.model.label ?? defaultId);

  const needle = state.query.trim().toLowerCase();
  const layout = {
    providers: groups
      .map((group) => ({
        provider: group.id,
        label: group.label,
        models: group.models
          .filter(
            (model) =>
              needle === "" ||
              model.label.toLowerCase().includes(needle) ||
              model.id.toLowerCase().includes(needle) ||
              group.label.toLowerCase().includes(needle),
          )
          .map((model) => ({
            provider: group.id,
            modelName: model.id,
            label: model.label,
          })),
      }))
      .filter((group) => group.models.length > 0),
  };

  return {
    matched: chosenId === undefined || found !== undefined,
    defaultModelLabel,
    props: {
      open: state.open,
      onOpenChange: (open) =>
        binding.setState(
          open ? { ...state, open } : { open: false, query: "" },
        ),
      current:
        chosenId === undefined
          ? NONE
          : {
              provider: found?.group.id ?? "",
              modelName: chosenId,
            },
      currentLabel:
        chosenId === undefined
          ? binding.followLabel
          : (found?.model.label ?? chosenId),
      axes: found === undefined ? [] : found.model.axes.map(acpAxisView),
      axesReady: catalog !== null && found !== undefined,
      optionValues: value?.options ?? {},
      query: state.query,
      layout,
      onQueryChange: (query) => binding.setState({ ...state, query }),
      onPick: (ref) => {
        const target = findModel(ref.modelName)?.model;
        if (target === undefined) return;
        const carried = carryHarnessOptions(target, value?.options);
        onChange(cleanHarnessConfig(target.id, carried));
      },
      onOptionChange: (axis, nextValue) => {
        if (chosenId === undefined) return;
        onChange(
          cleanHarnessConfig(chosenId, {
            ...(value?.options ?? {}),
            [axis]: nextValue,
          }),
        );
      },
      layer: null,
      follow: {
        label: binding.followLabel,
        on: chosenId === undefined,
        onFollow: () => {
          onChange(undefined);
          binding.setState({ open: false, query: "" });
        },
      },
    },
  };
}

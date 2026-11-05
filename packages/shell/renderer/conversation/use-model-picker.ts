// composer의 model 단추와 picker가 ACP session meta와 맞물리는 일.
// model 목록·축·지금 값은 모두 `session`이 준다. 화면 코드에는 model 이름도 option 값도 없다. 검색은 받은 목록을 거른다.
import { useEffect, useState } from "react";
import { t } from "@lophn/i18n";

import type { AcpModel, AcpSessionMeta } from "../../../protocol/acp/mod.ts";
import { fitOptionValues } from "../../../protocol/lophn-agent/model-picker.ts";
import type { CatalogEntry } from "../../../protocol/lophn-agent/models.ts";
import type { ModelPickerProps, PickerModelRef } from "./model-picker/types.ts";

const NO_MODEL: PickerModelRef = { provider: "", modelName: "" };

interface ModelPickerInput {
  /** 아직 모르면 null이다. */
  meta: AcpSessionMeta | null;
  /** `capabilities.effort`: model의 축 값을 바꿀 수 있다. */
  effort: boolean;
  /** null이면 아직 만들지 않은 새 session이다. */
  session: string | null;
  /** model과 축 값을 정한다. 접수되었는지 돌려준다. */
  onChoose: (
    model: string,
    options: Record<string, string>,
  ) => Promise<boolean>;
  /** 쓰기가 실패했다. */
  onProblem: () => void;
}

/** picker props와, 읽어 보니 model이 없다는 사실. 없으면 보내도 turn이 시작하지 못한다. */
export function useModelPicker(input: ModelPickerInput): {
  readonly props: ModelPickerProps;
  readonly noModel: boolean;
} {
  const { meta, effort, session, onChoose, onProblem } = input;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  // session이 바뀌면 열린 picker와 검색어는 옛 session의 것이다.
  useEffect(() => {
    setOpen(false);
    setQuery("");
  }, [session]);

  const groups = meta?.models ?? [];
  const current = meta?.model ?? null;
  const found = (id: string) => {
    for (const group of groups) {
      const model = group.models.find((one) => one.id === id);
      if (model !== undefined) return { group, model };
    }
    return undefined;
  };
  const currentFound = current === null ? undefined : found(current.model);

  const needle = query.trim().toLowerCase();
  const layout = {
    providers: groups
      .map((group) => ({
        provider: group.id,
        label: group.label,
        models: group.models
          .filter(
            (model) =>
              needle === "" || model.label.toLowerCase().includes(needle),
          )
          .map((model) => ({
            provider: group.id,
            modelName: model.id,
            label: model.label,
          })),
      }))
      .filter((group) => group.models.length > 0),
  };

  const choose = async (model: AcpModel, options: Record<string, string>) => {
    if (!(await onChoose(model.id, options))) onProblem();
  };

  return {
    // 새 session은 고른 model이 없는 것이 아니라 아직 고르지 않은 것이다.
    noModel: session !== null && meta !== null && current === null,
    props: {
      open,
      onOpenChange: (next) => {
        setOpen(next);
        if (!next) setQuery("");
      },
      current:
        current === undefined || current === null
          ? NO_MODEL
          : currentFound === undefined
            ? { provider: "", modelName: current.model }
            : { provider: currentFound.group.id, modelName: current.model },
      currentLabel: current?.label ?? t("conversation.label.model-unknown"),
      axes: effort ? (currentFound?.model.axes ?? []) : [],
      optionValues: current?.options ?? {},
      query,
      layout,
      onQueryChange: setQuery,
      // core는 options를 맞추지 않고 그대로 저장한다. 새 model에 맞추는 규칙은 지금 picker와 같은 것이다.
      onPick: (ref) => {
        const target = found(ref.modelName)?.model;
        if (target === undefined) return;
        void choose(
          target,
          fitOptionValues(
            { options: target.axes } as unknown as CatalogEntry,
            current?.options ?? {},
          ).option_values,
        );
      },
      onOptionChange: (axis, value) => {
        if (currentFound === undefined) return;
        void choose(currentFound.model, {
          ...current?.options,
          [axis]: value,
        });
      },
      layer: current?.layer ?? null,
    },
  };
}

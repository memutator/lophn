// composer의 model 단추와 picker가 source와 맞물리는 일(shell/desktop#R44, lophn-agent/conversation#R23).
// 고른 값은 이 session에만 저장하고, 화면 코드에는 model 이름도 option 값도 없다. 모두 source가 준다.
import { useEffect, useState } from "react";
import { t } from "@lophn/wording";

import type {
  AgentViewSource,
  ModelView,
  SourceResult,
} from "./agent-source.ts";
import type { ModelPickerProps, PickerModelRef } from "./model-picker/types.ts";

const NO_MODEL: PickerModelRef = { provider: "", modelName: "" };

export interface ModelPickerInput {
  source: AgentViewSource;
  /** null이면 아직 만들지 않은 새 session이다. */
  session: string | null;
  /** 읽거나 쓰기가 실패했다. */
  onProblem: () => void;
  onChangeDefaults: () => void;
}

export function useModelPicker(input: ModelPickerInput): ModelPickerProps {
  const { source, session, onProblem } = input;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<ModelView | null>(null);

  // session이 바뀌면 열린 picker와 검색어는 옛 session의 것이다.
  useEffect(() => {
    setOpen(false);
    setQuery("");
  }, [session]);

  useEffect(() => {
    let live = true;
    void source.model(session, query).then((read) => {
      if (live && read.ok) setView(read.value);
    });
    return () => {
      live = false;
    };
  }, [source, session, query]);

  const apply = async (call: Promise<SourceResult<ModelView>>) => {
    const result = await call;
    if (result.ok) setView(result.value);
    else onProblem();
  };

  return {
    open,
    onOpenChange: (next) => {
      setOpen(next);
      if (!next) {
        // 닫으면 값 맞춤 알림은 지나간 일이다.
        setQuery("");
        setView((current) => current && { ...current, notices: [] });
      }
    },
    current: view?.current ?? NO_MODEL,
    currentLabel: view?.currentLabel ?? t("conversation.label.model-unknown"),
    axes: view?.axes ?? [],
    optionValues: view?.optionValues ?? {},
    query,
    layout: view?.layout ?? { favorites: [], providers: [] },
    notices: view?.notices ?? [],
    onQueryChange: setQuery,
    onPick: (model) => void apply(source.chooseModel(session, model, query)),
    onToggleFavorite: (model) =>
      void apply(source.toggleFavorite(session, model, query)),
    onOptionChange: (axis, value) =>
      void apply(source.setModelOption(session, axis, value, query)),
    onChangeDefaults: input.onChangeDefaults,
  };
}

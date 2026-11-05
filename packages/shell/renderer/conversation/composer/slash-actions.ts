// `/` 명령 중 composer 안 상태(model picker, mode menu)를 여는 것. 이 상태는 composer가 쥐고 있어서 화면이 아니라
// composer가 실행하기 전에 가로챈다. 인자가 있어도 `argument_hint`가 있는 명령은 CLI가 받으므로 여기서 다루지 않는다.
import type {
  AcpChoice,
  AcpSessionMeta,
} from "../../../../protocol/acp/mod.ts";
import type { SlashEntryView } from "../slash-menu/types.ts";

interface ComposerActions {
  meta: AcpSessionMeta | null;
  mode: {
    readonly choices: readonly AcpChoice[];
    readonly onChange: (mode: string) => void;
  } | null;
  openPicker: () => void;
  openMode: () => void;
  /** picker에서 model을 고른 것과 같다(축 값은 새 model에 맞춘다). */
  chooseModel: (model: string) => void;
  chooseOptions: (model: string, options: Record<string, string>) => void;
  onProblem: () => void;
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** 다룬 명령이면 true다. */
export function runComposerCommand(
  entry: SlashEntryView,
  argument: string,
  actions: ComposerActions,
): boolean {
  const { opens } = entry;
  if (opens !== "model" && opens !== "effort" && opens !== "mode") return false;
  if (argument !== "" && entry.argumentHint !== null) return false;
  const { meta } = actions;
  if (opens === "mode") {
    if (actions.mode === null) return true;
    if (argument === "") return (void actions.openMode(), true);
    const mode = actions.mode.choices.find(
      (one) => one.id === argument || same(one.label, argument),
    );
    if (mode === undefined) actions.onProblem();
    else actions.mode.onChange(mode.id);
    return true;
  }
  if (argument === "") return (void actions.openPicker(), true);
  const models = meta?.models.flatMap((group) => group.models) ?? [];
  if (opens === "model") {
    const model = models.find(
      (one) => one.id === argument || same(one.label, argument),
    );
    if (model === undefined) actions.onProblem();
    else actions.chooseModel(model.id);
    return true;
  }
  // effort: 지금 model의 effort 축 값을 바꾼다.
  const current = meta?.model ?? null;
  const axis = models
    .find((one) => one.id === current?.model)
    ?.axes.find((one) => one.id === "effort");
  const value = axis?.values.find(
    (one) => one.value === argument || same(one.label, argument),
  );
  if (current === null || value === undefined) actions.onProblem();
  else {
    actions.chooseOptions(current.model, {
      ...current.options,
      effort: value.value,
    });
  }
  return true;
}

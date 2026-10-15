// Search 탭의 본문: 고른 검색의 제목, 입력 form, [Save as view]의 이름 칸,
// 결과. 입력을 바꾸는 일은 곧바로 state로 알리고, 결과는 [Search]를 눌러야 바뀐 입력으로 다시 읽는다.
import { type ReactNode, useState } from "react";
import {
  Button,
  ErrorState,
  Field,
  Input,
  Skeleton,
} from "@lophn/design/components";
import { t } from "@lophn/wording";

import { SearchInputForm } from "./search-input-form.tsx";
import styles from "./search-tab.module.css";
import { missingInputs, pickInputs, withInput } from "./search-tab-inputs.ts";
import { useRead } from "./search-tab-read.ts";
import { SearchTabResults } from "./search-tab-results.tsx";
import type { SearchTabState } from "./search-tab.tsx";
import type { OpenDocument } from "./shared.ts";
import type { ContextsSource, DeclaredSearch, PickOption } from "./source.ts";

export interface SearchBodyProps {
  readonly source: ContextsSource;
  readonly search: DeclaredSearch;
  readonly state: SearchTabState;
  readonly onState: (next: SearchTabState) => void;
  readonly onOpenDocument: OpenDocument;
  readonly onAsk?: () => void;
  /** 보기를 저장한 뒤, Saved views를 다시 읽게 한다. */
  readonly onSaved: () => void;
}

type OptionMap = Readonly<Record<string, readonly PickOption[]>>;

export function SearchBody(props: SearchBodyProps): ReactNode {
  const { source, search, state, onState } = props;
  // 결과가 보이는 입력. 처음엔 열 때의 입력이고 [Search]를 누를 때 지금 입력으로 바뀐다.
  const [applied, setApplied] = useState(state.inputs);
  const [naming, setNaming] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const options = useRead<OptionMap>(
    `${state.context}/${search.name}`,
    async () => {
      const reads = await Promise.all(
        pickInputs(search).map((input) =>
          source.inputOptions({
            context: state.context,
            search: search.name,
            input: input.name,
          })
        ),
      );
      const map: Record<string, readonly PickOption[]> = {};
      for (const [index, input] of pickInputs(search).entries()) {
        const read = reads[index]!;
        if (!read.ok) return read;
        map[input.name] = read.value.options;
      }
      return { ok: true, value: map };
    },
  );

  const missing = missingInputs(search, applied);

  async function save(): Promise<void> {
    const name = (naming ?? "").trim();
    if (name === "" || busy) return;
    setBusy(true);
    setFailed(false);
    const result = await source.saveView({
      context: state.context,
      name,
      search: search.name,
      inputs: state.inputs,
    }).catch(() => null);
    setBusy(false);
    if (result?.ok) {
      setNaming(null);
      props.onSaved();
    } else {
      setFailed(true);
    }
  }

  return (
    <div className={styles.body}>
      <h1 className={styles.title}>{search.title}</h1>
      {options.slot.status === "loading" && <Skeleton lines={4} />}
      {options.slot.status === "failed" && (
        <ErrorState target={search.title} onRetry={options.reload} />
      )}
      {options.slot.status === "loaded" && (
        <SearchInputForm
          search={search}
          values={state.inputs}
          options={options.slot.value}
          onChange={(name, value) =>
            onState({
              ...state,
              inputs: withInput(state.inputs, name, value),
              page: 0,
            })}
          onSearch={() => {
            setApplied(state.inputs);
            if (state.page !== 0) onState({ ...state, page: 0 });
          }}
          onSaveView={() =>
            setNaming((current) => current === null ? "" : null)}
          onAsk={props.onAsk}
        />
      )}
      {naming !== null && (
        <div className={styles.save} data-save-view>
          <Field
            label={t("contexts.label.search-view-name")}
            {...(failed
              ? { error: t("contexts.error.search-save-failed") }
              : {})}
          >
            <Input
              value={naming}
              autoFocus
              onChange={(event) => setNaming(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void save();
              }}
            />
          </Field>
          <Button
            variant="primary"
            disabled={naming.trim() === "" || busy}
            onClick={() => void save()}
          >
            {t("contexts.button.search-save")}
          </Button>
        </div>
      )}
      {missing.length > 0 && (
        <p className={styles.note} data-input-required>
          {t("contexts.note.input-required", {
            inputs: missing.map((input) => input.label).join(", "),
          })}
        </p>
      )}
      {missing.length === 0 && (
        <SearchTabResults
          source={source}
          context={state.context}
          search={search}
          inputs={applied}
          page={state.page}
          onPage={(page) => onState({ ...state, page })}
          onOpenDocument={props.onOpenDocument}
        />
      )}
    </div>
  );
}

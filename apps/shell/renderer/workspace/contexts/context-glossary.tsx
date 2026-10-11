// Glossary: 이 context의 용어와 뜻을 목록으로 보고, 사람이 추가·고침·지운다(shell/workspace#R20).
// 줄마다 누가(You / Context Engineer) 언제(2 days ago) 정했는지 보인다. 구현은 ctx-I45.
// 문구 key는 packages/design/wording/en.ts에 이미 있다. 구현은 en.ts를 고치지 않고 아래 key만 t()로 쓴다:
//   contexts.button.glossary-add
//   contexts.button.glossary-add-term
//   contexts.button.glossary-cancel
//   contexts.button.glossary-delete
//   contexts.button.glossary-edit
//   contexts.button.glossary-save
//   contexts.empty.glossary-none
//   contexts.error.glossary-failed
//   contexts.label.glossary-by-agent
//   contexts.label.glossary-by-user
//   contexts.label.glossary-meaning
//   contexts.label.glossary-term
//   contexts.note.glossary-purpose
//   common.error.load-failed
// "2 days ago"는 wording의 formatRelativeTime으로 만든다.
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  Button,
  EmptyState,
  ErrorState,
  Loading,
  lophnSpaceIcons,
  Skeleton,
} from "@lophn/design/components";
import { t } from "@lophn/wording";

import { GlossaryFields } from "./context-glossary-fields.tsx";
import {
  type GlossaryChanges,
  isBlank,
  type TermDraft,
} from "./context-glossary-model.ts";
import { GlossaryRow } from "./context-glossary-row.tsx";
import styles from "./context-glossary.module.css";
import type { ContextsSource, GlossaryEntry, ReadResult } from "./source.ts";

export interface ContextGlossaryProps {
  readonly source: ContextsSource;
  /** context ID. */
  readonly context: string;
  /** 새 항목의 `trm` ID를 만든다. */
  readonly newId: () => string;
  /** "2 days ago"를 재는 지금. 기본은 현재 시각. */
  readonly now?: Date;
}

type Load =
  | { readonly state: "loading" }
  | { readonly state: "failed" }
  | { readonly state: "loaded"; readonly entries: readonly GlossaryEntry[] };

/** 추가 중인 항목. ID는 form을 열 때 한 번 만들어 재시도에도 같은 ID를 쓴다. */
interface Adding {
  readonly id: string;
  readonly draft: TermDraft;
}

export function ContextGlossary(
  { source, context, newId, now }: ContextGlossaryProps,
): ReactNode {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [adding, setAdding] = useState<Adding | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const clock = now ?? new Date();

  useEffect(() => {
    let current = true;
    setLoad({ state: "loading" });
    setAdding(null);
    setFailure(null);
    source.glossary(context).then(
      (result) => {
        if (current) setLoad(loaded(result));
      },
      () => {
        if (current) setLoad({ state: "failed" });
      },
    );
    return () => {
      current = false;
    };
  }, [source, context, attempt]);

  // 명령이 성공하면 목록을 다시 읽는다. 용어 순서와 revision은 source가 정한다.
  const perform = async (
    command: () => Promise<ReadResult<unknown>>,
  ): Promise<boolean> => {
    setBusy(true);
    setFailure(null);
    try {
      const result = await command();
      if (!result.ok) {
        setFailure(result.message);
        return false;
      }
      setLoad(loaded(await source.glossary(context)));
      return true;
    } finally {
      setBusy(false);
    }
  };

  const saveEntry = (
    entry: GlossaryEntry,
    changes: GlossaryChanges,
  ): Promise<boolean> =>
    perform(() =>
      source.glossarySet(
        { entry: entry.id, ...changes },
        { base_revision: entry.revision },
      )
    );

  const removeEntry = (entry: GlossaryEntry): Promise<boolean> =>
    perform(() =>
      source.glossaryRemove(
        { entry: entry.id },
        { base_revision: entry.revision },
      )
    );

  const startAdding = (): void => {
    setFailure(null);
    setAdding({ id: newId(), draft: { term: "", meaning: "" } });
  };

  const submitAdd = async (current: Adding): Promise<void> => {
    const saved = await perform(() =>
      source.glossarySet({
        id: current.id,
        context,
        term: current.draft.term.trim(),
        meaning: current.draft.meaning.trim(),
      })
    );
    if (saved) setAdding(null);
  };

  const cancelAdding = (): void => {
    setFailure(null);
    setAdding(null);
  };

  const retry = (): void => {
    setLoad({ state: "loading" });
    setAttempt((count) => count + 1);
  };

  return (
    <section className={styles.screen}>
      <p className={styles.note} data-glossary-note>
        {t("contexts.note.glossary-purpose")}
      </p>
      <Loading
        loading={load.state === "loading"}
        placeholder={<Skeleton lines={3} />}
      >
        {load.state === "failed" && (
          <ErrorState
            target={t("contexts.label.sub-glossary")}
            onRetry={retry}
          />
        )}
        {load.state === "loaded" && (
          <>
            {failure !== null && (
              <div className={styles.failure} data-glossary-failure>
                <p className={styles.failureNote}>
                  {t("contexts.error.glossary-failed")}
                </p>
                <p className={styles.alert} role="alert">{failure}</p>
              </div>
            )}
            {load.entries.length === 0 && adding === null && (
              <EmptyState
                icon={lophnSpaceIcons.add}
                message={t("contexts.empty.glossary-none")}
                action={{
                  label: t("contexts.button.glossary-add-term"),
                  onSelect: startAdding,
                }}
              />
            )}
            {load.entries.length > 0 && (
              <ul className={styles.list}>
                {load.entries.map((entry) => (
                  <GlossaryRow
                    key={entry.id}
                    entry={entry}
                    now={clock}
                    busy={busy}
                    onSave={(changes) => saveEntry(entry, changes)}
                    onDelete={() => void removeEntry(entry)}
                  />
                ))}
              </ul>
            )}
            {adding !== null
              ? (
                <div className={styles.adding} data-glossary-add>
                  <GlossaryFields
                    value={adding.draft}
                    disabled={busy}
                    onChange={(draft) => setAdding({ id: adding.id, draft })}
                  />
                  <div className={styles.actions}>
                    <Button
                      variant="primary"
                      disabled={busy || isBlank(adding.draft)}
                      onClick={() => void submitAdd(adding)}
                    >
                      {t("contexts.button.glossary-add")}
                    </Button>
                    <Button disabled={busy} onClick={cancelAdding}>
                      {t("contexts.button.glossary-cancel")}
                    </Button>
                  </div>
                </div>
              )
              : load.entries.length > 0 && (
                <div>
                  <Button
                    icon={lophnSpaceIcons.add}
                    disabled={busy}
                    onClick={startAdding}
                  >
                    {t("contexts.button.glossary-add-term")}
                  </Button>
                </div>
              )}
          </>
        )}
      </Loading>
    </section>
  );
}

function loaded(result: ReadResult<readonly GlossaryEntry[]>): Load {
  return result.ok
    ? { state: "loaded", entries: result.value }
    : { state: "failed" };
}

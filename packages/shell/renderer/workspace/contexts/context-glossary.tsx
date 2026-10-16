// Glossary: 머리 줄(Glossary · 용어 수 · 오른쪽 끝 [Add term])과 용어 목록. 사람이 더하고 고치는 일은 그
// 줄에서 바로 하고(Enter·✓ 저장, Esc·× 취소), 지우기는 확인 modal을 거친다. 줄마다 누가(You / Project
// Manager) 언제(2 days ago) 정했는지 보인다. 한 번에 한 줄만 고친다: 다른 줄의 [Edit]이나 [Add term]을
// 누르면 쓰던 줄은 저장 없이 닫힌다.
// 문구 key는 아래만 t()로 쓴다:
//   contexts.button.glossary-add-term
//   contexts.button.glossary-cancel
//   contexts.button.glossary-delete
//   contexts.empty.glossary-none
//   contexts.error.glossary-failed
//   contexts.label.glossary-count
//   contexts.label.sub-glossary
//   contexts.note.glossary-delete
//   contexts.title.glossary-delete
//   common.error.load-failed
// "2 days ago"는 wording의 formatRelativeTime으로 만든다.
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  Button,
  Dialog,
  ErrorState,
  Loading,
  Skeleton,
} from "@lophn/design/components";
import { t } from "@lophn/wording";

import { GlossaryFields } from "./context-glossary-fields.tsx";
import type { GlossaryChanges, TermDraft } from "./context-glossary-model.ts";
import { changesOf } from "./context-glossary-model.ts";
import { GlossaryRow } from "./context-glossary-row.tsx";
import styles from "./context-glossary.module.css";
import { errorReason } from "./error-reason.ts";
import type { ContextsSource, GlossaryEntry, ReadResult } from "./source.ts";

interface ContextGlossaryProps {
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

/** 그 줄에서 열어 둔 것. add의 ID는 줄을 열 때 한 번 만들어 재시도에도 같은 ID를 쓴다. */
type Mode =
  | { readonly kind: "add"; readonly id: string }
  | { readonly kind: "edit"; readonly entry: string }
  | null;

export function ContextGlossary(
  { source, context, newId, now }: ContextGlossaryProps,
): ReactNode {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [mode, setMode] = useState<Mode>(null);
  const [deleting, setDeleting] = useState<GlossaryEntry | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const clock = now ?? new Date();

  useEffect(() => {
    let current = true;
    setLoad({ state: "loading" });
    setMode(null);
    setDeleting(null);
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

  const saveEdit = async (
    entry: GlossaryEntry,
    draft: TermDraft,
  ): Promise<void> => {
    const changes: GlossaryChanges | null = changesOf(entry, draft);
    if (changes === null) {
      setMode(null);
      return;
    }
    const saved = await perform(() =>
      source.glossarySet(
        { entry: entry.id, ...changes },
        { base_revision: entry.revision },
      )
    );
    if (saved) setMode(null);
  };

  const saveAdd = async (id: string, draft: TermDraft): Promise<void> => {
    const saved = await perform(() =>
      source.glossarySet({
        id,
        context,
        term: draft.term.trim(),
        meaning: draft.meaning.trim(),
      })
    );
    if (saved) setMode(null);
  };

  const confirmDelete = async (entry: GlossaryEntry): Promise<void> => {
    await perform(() =>
      source.glossaryRemove(
        { entry: entry.id },
        { base_revision: entry.revision },
      )
    );
    setDeleting(null);
  };

  const open = (next: Mode): void => {
    setFailure(null);
    setMode(next);
  };
  const entries = load.state === "loaded" ? load.entries : [];

  return (
    <section className={styles.screen}>
      <div className={styles.head}>
        <h2 className={styles.heading}>
          {t("contexts.label.sub-glossary")}
          {load.state === "loaded" && (
            <span className={styles.count} data-glossary-count>
              {t("contexts.label.glossary-count", {
                count: entries.length,
              })}
            </span>
          )}
        </h2>
        <Button
          variant="primary"
          data-glossary-add
          disabled={load.state !== "loaded" || busy || mode?.kind === "add"}
          onClick={() => open({ kind: "add", id: newId() })}
        >
          {t("contexts.button.glossary-add-term")}
        </Button>
      </div>
      <Loading
        loading={load.state === "loading"}
        placeholder={<Skeleton lines={3} />}
      >
        {load.state === "failed" && (
          <ErrorState
            target={t("contexts.label.sub-glossary")}
            onRetry={() => setAttempt((count) => count + 1)}
          />
        )}
        {load.state === "loaded" && (
          <>
            {failure !== null && (
              <div className={styles.failure} data-glossary-failure>
                <p className={styles.failureNote}>
                  {t("contexts.error.glossary-failed")}
                </p>
                <p className={styles.alert} role="alert">
                  {errorReason(failure)}
                </p>
              </div>
            )}
            {entries.length === 0 && mode === null && (
              <p className={styles.note}>
                {t("contexts.empty.glossary-none")}
              </p>
            )}
            <ul className={styles.list}>
              {mode?.kind === "add" && (
                <GlossaryFields
                  key={mode.id}
                  initial={{ term: "", meaning: "" }}
                  busy={busy}
                  onSave={(draft) => void saveAdd(mode.id, draft)}
                  onCancel={() => open(null)}
                />
              )}
              {entries.map((entry) =>
                mode?.kind === "edit" && mode.entry === entry.id
                  ? (
                    <GlossaryFields
                      key={entry.id}
                      initial={{ term: entry.term, meaning: entry.meaning }}
                      busy={busy}
                      onSave={(draft) => void saveEdit(entry, draft)}
                      onCancel={() => open(null)}
                    />
                  )
                  : (
                    <GlossaryRow
                      key={entry.id}
                      entry={entry}
                      now={clock}
                      busy={busy}
                      onEdit={() => open({ kind: "edit", entry: entry.id })}
                      onDelete={() => setDeleting(entry)}
                    />
                  )
              )}
            </ul>
          </>
        )}
      </Loading>
      <Dialog
        open={deleting !== null}
        onOpenChange={(next) => {
          if (!next) setDeleting(null);
        }}
        title={t("contexts.title.glossary-delete", {
          term: deleting?.term ?? "",
        })}
        actions={
          <>
            <Button onClick={() => setDeleting(null)}>
              {t("contexts.button.glossary-cancel")}
            </Button>
            <Button
              variant="danger"
              disabled={busy}
              onClick={() => deleting && void confirmDelete(deleting)}
            >
              {t("contexts.button.glossary-delete")}
            </Button>
          </>
        }
      >
        <p className={styles.note}>{t("contexts.note.glossary-delete")}</p>
      </Dialog>
    </section>
  );
}

function loaded(result: ReadResult<readonly GlossaryEntry[]>): Load {
  return result.ok
    ? { state: "loaded", entries: result.value }
    : { state: "failed" };
}

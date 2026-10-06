import { type FormEvent, useEffect, useState } from "react";
import {
  Button,
  ErrorState,
  Field,
  Input,
  lophnSpaceIcons,
  Textarea,
} from "@lophn/design/components";
import { t } from "@lophn/wording";

import { EVIDENCE_LIMIT } from "../model.ts";
import type {
  ContextsSource,
  Meaning,
  MeaningEvidence,
  Meanings as MeaningList,
} from "../source.ts";
import styles from "../contexts.module.css";

export interface MeaningsProps {
  source: ContextsSource;
  focus: string;
  /** 연결이 다시 준비되면 오른다. 다시 읽는다. */
  connected?: number;
  onRead: (document: string, version: string, section: string | null) => void;
}

type Loaded =
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | { readonly kind: "ready"; readonly value: MeaningList };

/** 지금 쓰는 form. 후보·정의를 정하거나 새 뜻을 더한다. */
type Editing =
  | { readonly kind: "none" }
  | { readonly kind: "term"; readonly term: Meaning }
  | { readonly kind: "new" };

// Focus의 뜻. 사람이 정한 뜻과 아직 정하지 않은 후보를 나누고 후보마다 출현 근거를 최대 5개
// 보인다. 사람이 이름·뜻을 직접 써서 정하거나 미룬다. 추천이나 후보 이름을 뜻으로 채우지 않는다
// (documents/terms#R2, R4, flow define-terms).
export function Meanings(
  { source, focus, connected = 0, onRead }: MeaningsProps,
) {
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [editing, setEditing] = useState<Editing>({ kind: "none" });
  const [deferred, setDeferred] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<"changed" | "failed" | null>(null);

  useEffect(() => {
    let live = true;
    void source.meanings(focus).then((result) => {
      if (!live) return;
      setLoaded(
        result.ok ? { kind: "ready", value: result.value } : { kind: "failed" },
      );
    });
    return () => {
      live = false;
    };
  }, [source, focus, attempt, connected]);

  if (loaded.kind === "loading") return null;
  if (loaded.kind === "failed") {
    return (
      <ErrorState
        target={t("contexts.label.target-meanings")}
        onRetry={() => setAttempt((value) => value + 1)}
      />
    );
  }

  const { definitions, candidates, partial } = loaded.value;
  const reload = () => setAttempt((value) => value + 1);

  const save = async (name: string, definition: string) => {
    const term = editing.kind === "term" ? editing.term : undefined;
    const result = await source.define({
      focus,
      ...(term === undefined ? {} : { term }),
      name,
      definition,
    });
    if (!result.ok) {
      if (result.code === "conflict") {
        setError("changed");
        setEditing({ kind: "none" });
        reload();
      } else {
        setError("failed");
      }
      return;
    }
    setError(null);
    setEditing({ kind: "none" });
    reload();
  };

  const form = (key: string) =>
    editing.kind !== "none" &&
      (editing.kind === "new" ? key === "new" : editing.term.id === key)
      ? (
        <MeaningForm
          initialName={editing.kind === "term" ? editing.term.name : ""}
          initialDefinition={editing.kind === "term"
            ? editing.term.definition ?? ""
            : ""}
          onSave={(name, definition) => void save(name, definition)}
          onCancel={() => setEditing({ kind: "none" })}
        />
      )
      : null;

  return (
    <div className={styles.meanings} data-meanings="">
      {error === "changed"
        ? (
          <p className={styles.notice} data-meaning-changed="">
            {t("contexts.error.meaning-changed")}
          </p>
        )
        : null}
      {error === "failed"
        ? (
          <p className={styles.error} data-meaning-failed="">
            {t("contexts.error.define-failed")}
          </p>
        )
        : null}
      {partial
        ? <p className={styles.hint}>{t("contexts.notice.partial")}</p>
        : null}
      <section className={styles.perspective} data-definitions="">
        <h2 className={styles.perspectiveLabel}>
          {t("contexts.heading.definitions")}
        </h2>
        {definitions.length === 0
          ? <p className={styles.hint}>{t("contexts.empty.definitions")}</p>
          : (
            <ul className={styles.terms}>
              {definitions.map((term) => (
                <li key={term.id} className={styles.term} data-term={term.id}>
                  <div className={styles.termHead}>
                    <p className={styles.termName}>{term.name}</p>
                    <Button
                      size="sm"
                      variant="ghost"
                      data-change-meaning=""
                      onClick={() =>
                        setEditing({ kind: "term", term })}
                    >
                      {t("contexts.button.change")}
                    </Button>
                  </div>
                  <p className={styles.definition} data-definition="">
                    {term.definition}
                  </p>
                  <Evidence term={term} onRead={onRead} />
                  {form(term.id)}
                </li>
              ))}
            </ul>
          )}
        {editing.kind === "new" ? form("new") : (
          <div className={styles.buttons}>
            <Button
              size="sm"
              icon={lophnSpaceIcons.add}
              data-new-meaning=""
              onClick={() => setEditing({ kind: "new" })}
            >
              {t("contexts.button.new-meaning")}
            </Button>
          </div>
        )}
      </section>
      <section className={styles.perspective} data-candidates="">
        <h2 className={styles.perspectiveLabel}>
          {t("contexts.heading.candidates")}
        </h2>
        {candidates.length === 0
          ? <p className={styles.hint}>{t("contexts.empty.candidates")}</p>
          : (
            <ul className={styles.terms}>
              {candidates.map((term) => (
                <li
                  key={term.id}
                  className={styles.term}
                  data-candidate={term.id}
                >
                  <div className={styles.termHead}>
                    <p className={styles.termName}>{term.name}</p>
                    {editing.kind === "term" && editing.term.id === term.id
                      ? null
                      : (
                        <span className={styles.buttons}>
                          <Button
                            size="sm"
                            variant="primary"
                            data-decide=""
                            onClick={() => setEditing({ kind: "term", term })}
                          >
                            {t("contexts.button.decide")}
                          </Button>
                          {deferred.has(term.id) ? null : (
                            <Button
                              size="sm"
                              variant="ghost"
                              data-later=""
                              onClick={() =>
                                setDeferred(new Set([...deferred, term.id]))}
                            >
                              {t("contexts.button.later")}
                            </Button>
                          )}
                        </span>
                      )}
                  </div>
                  {deferred.has(term.id)
                    ? (
                      <p className={styles.hint} data-deferred="">
                        {t("contexts.notice.deferred")}
                      </p>
                    )
                    : null}
                  <Evidence term={term} onRead={onRead} />
                  {form(term.id)}
                </li>
              ))}
            </ul>
          )}
      </section>
    </div>
  );
}

function evidenceMeta(item: MeaningEvidence): string[] {
  const parts: string[] = [];
  if (item.section !== null) {
    parts.push(t("contexts.label.section", { section: item.section }));
  }
  if (item.startLine !== null && item.endLine !== null) {
    parts.push(
      t("contexts.label.evidence-lines", {
        start: item.startLine,
        end: item.endLine,
      }),
    );
  }
  return parts;
}

// 출현 근거. 고정 판의 section·줄 범위로 열고 최대 5개만 보인다.
function Evidence(
  { term, onRead }: {
    term: Meaning;
    onRead: (document: string, version: string, section: string | null) => void;
  },
) {
  if (term.evidence.length === 0) return null;
  const shown = term.evidence.slice(0, EVIDENCE_LIMIT);
  const more = term.evidence.length - shown.length;
  return (
    <div className={styles.field}>
      <span className={styles.fieldLabel}>{t("contexts.label.evidence")}</span>
      <ul className={styles.evidence} data-evidence="">
        {shown.map((item) => (
          <li
            key={`${item.document}:${item.version}:${item.section ?? ""}:${
              item.startLine ?? ""
            }`}
          >
            <button
              type="button"
              className={styles.evidenceRow}
              data-evidence-row={item.document}
              onClick={() => onRead(item.document, item.version, item.section)}
            >
              <span className={styles.evidenceTitle}>
                {item.title ?? t("contexts.label.untitled")}
              </span>
              {evidenceMeta(item).map((part) => <span key={part}>{part}</span>)}
            </button>
          </li>
        ))}
      </ul>
      {more > 0
        ? (
          <span className={styles.hint} data-evidence-more={more}>
            {t("contexts.label.evidence-more", { count: more })}
          </span>
        )
        : null}
    </div>
  );
}

// 사람이 쓰는 이름과 뜻. 뜻 칸은 사람이 직접 쓴다. 후보의 뜻을 미리 채우지 않는다.
function MeaningForm(
  { initialName, initialDefinition, onSave, onCancel }: {
    initialName: string;
    initialDefinition: string;
    onSave: (name: string, definition: string) => void;
    onCancel: () => void;
  },
) {
  const [name, setName] = useState(initialName);
  const [definition, setDefinition] = useState(initialDefinition);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim() === "" || definition.trim() === "") return;
    onSave(name.trim(), definition.trim());
  };
  return (
    <form className={styles.form} onSubmit={submit} data-meaning-form="">
      <p className={styles.hint}>{t("contexts.notice.write-own")}</p>
      <Field label={t("contexts.label.word")}>
        <Input
          data-meaning-name=""
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </Field>
      <Field label={t("contexts.label.meaning")}>
        <Textarea
          data-meaning-definition=""
          rows={3}
          value={definition}
          onChange={(event) => setDefinition(event.target.value)}
        />
      </Field>
      <div className={styles.buttons}>
        <Button
          type="submit"
          variant="primary"
          size="sm"
          data-save-meaning=""
          disabled={name.trim() === "" || definition.trim() === ""}
        >
          {t("contexts.button.save-meaning")}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          {t("common.button.cancel")}
        </Button>
      </div>
    </form>
  );
}

import { useState } from "react";
import { Button, Checkbox, Field, Select } from "@lophn/design/components";
import { t } from "@lophn/wording";

import type { PlaceRef } from "../source.ts";
import { keptOriginal, leftOut } from "./model.ts";
import type {
  ExportFormat,
  ExportResult,
  OrganizeSource,
  PlacedDocument,
  VersionRow,
} from "./source.ts";
import listStyles from "../documents/documents.module.css";
import styles from "./organize.module.css";

export interface ExportPanelProps {
  source: OrganizeSource;
  place: PlaceRef;
  documents: readonly PlacedDocument[];
}

type Outcome =
  | { readonly kind: "idle" }
  | { readonly kind: "done"; readonly result: ExportResult }
  | { readonly kind: "changed" }
  | { readonly kind: "failed" };

/** 고른 문서의 판. 판 목록을 읽기 전에는 최신 판이다. */
interface Pick {
  readonly version: string;
  readonly versions: readonly VersionRow[] | null;
}

// 자리 안 문서와 고정 판을 골라 Markdown·JSON으로 export한다(documents/versions#R16, flow
// organize-documents 6·7). 결과는 실제로 묶은 문서·판·원래 파일과, 넣지 않은 문서를 나눠 보인다.
// 원래 파일을 돌려줄 수 없는 판은 빈 내용이나 온전한 export로 보이지 않는다.
export function ExportPanel({ source, place, documents }: ExportPanelProps) {
  const [picks, setPicks] = useState<ReadonlyMap<string, Pick>>(new Map());
  const [format, setFormat] = useState<ExportFormat>("markdown");
  const [outcome, setOutcome] = useState<Outcome>({ kind: "idle" });
  const [busy, setBusy] = useState(false);

  const toggle = (document: PlacedDocument, checked: boolean) => {
    const next = new Map(picks);
    if (!checked) {
      next.delete(document.id);
      setPicks(next);
      return;
    }
    next.set(document.id, { version: document.latestVersion, versions: null });
    setPicks(next);
    // 고정 판을 고를 수 있게 판 목록을 읽는다. 읽지 못하면 최신 판만 고른다.
    void source.versions(document.id).then((read) => {
      if (!read.ok) return;
      setPicks((current) => {
        const chosen = current.get(document.id);
        if (chosen === undefined) return current;
        const updated = new Map(current);
        updated.set(document.id, { ...chosen, versions: read.value });
        return updated;
      });
    });
  };

  const choose = (document: string, version: string) => {
    const chosen = picks.get(document);
    if (chosen === undefined) return;
    const next = new Map(picks);
    next.set(document, { ...chosen, version });
    setPicks(next);
  };

  const run = async () => {
    const selected = documents.filter((item) => picks.has(item.id)).map((
      item,
    ) => ({ document: item.id, version: picks.get(item.id)!.version }));
    if (selected.length === 0) return;
    setBusy(true);
    const result = await source.exportDocuments(place, selected, format);
    setBusy(false);
    setOutcome(
      result.ok
        ? { kind: "done", result: result.value }
        : result.code === "conflict"
        ? { kind: "changed" }
        : { kind: "failed" },
    );
  };

  const picked = new Set(picks.keys());

  return (
    <section className={listStyles.section} data-export="">
      <h2 className={listStyles.sectionLabel}>
        {t("projects.heading.export")}
      </h2>
      <p className={listStyles.hint}>{t("projects.notice.export-pick")}</p>
      <ul className={listStyles.rows}>
        {documents.map((document) => {
          const chosen = picks.get(document.id);
          return (
            <li
              key={document.id}
              className={styles.exportRow}
              data-export-document={document.id}
            >
              <div className={styles.grow}>
                <Checkbox
                  label={document.title}
                  checked={chosen !== undefined}
                  onCheckedChange={(checked) => toggle(document, checked)}
                />
              </div>
              {chosen !== undefined && chosen.versions !== null
                ? (
                  <div className={styles.versionField}>
                    <Field label={t("projects.label.export-version")}>
                      <Select
                        size="sm"
                        options={chosen.versions.map((version) => ({
                          value: version.id,
                          label: version.id === document.latestVersion
                            ? t("projects.label.version-latest", {
                              number: version.number,
                            })
                            : t("projects.label.version-number", {
                              number: version.number,
                            }),
                        }))}
                        value={chosen.version}
                        onValueChange={(version) =>
                          choose(document.id, version)}
                      />
                    </Field>
                  </div>
                )
                : null}
            </li>
          );
        })}
      </ul>
      <div className={styles.form}>
        <div className={styles.versionField}>
          <Field label={t("projects.label.export-format")}>
            <Select
              options={[
                {
                  value: "markdown",
                  label: t("projects.label.format-markdown"),
                },
                { value: "json", label: t("projects.label.format-json") },
              ]}
              value={format}
              onValueChange={(value) => setFormat(value as ExportFormat)}
            />
          </Field>
        </div>
        <Button
          variant="primary"
          data-export-run=""
          disabled={busy || picked.size === 0}
          onClick={() => void run()}
        >
          {t("projects.button.export", { count: picked.size })}
        </Button>
      </div>
      {outcome.kind === "changed"
        ? (
          <p className={listStyles.notice} data-export-changed="">
            {t("projects.error.export-changed")}
          </p>
        )
        : outcome.kind === "failed"
        ? (
          <p className={listStyles.error} data-export-failed="">
            {t("projects.error.export-failed")}
          </p>
        )
        : outcome.kind === "done"
        ? (
          <ExportSummary
            result={outcome.result}
            left={leftOut(
              documents,
              new Set(outcome.result.documents.map((item) => item.document)),
            )}
          />
        )
        : null}
    </section>
  );
}

function ExportSummary(
  { result, left }: {
    result: ExportResult;
    left: readonly PlacedDocument[];
  },
) {
  return (
    <div className={styles.result} data-export-result={result.format}>
      <h3 className={listStyles.sectionLabel}>
        {t("projects.heading.export-included")}
      </h3>
      <ul className={listStyles.rows}>
        {result.documents.map((item) => (
          <li
            key={item.document}
            className={styles.result}
            data-export-included={item.document}
          >
            <span className={listStyles.rowHead}>
              <span className={listStyles.rowTitle}>{item.title}</span>
              <span className={listStyles.meta}>
                {t("projects.label.version-number", { number: item.number })}
              </span>
            </span>
            {item.files === null
              ? (
                <p className={listStyles.notice} data-export-no-files="">
                  {t("projects.label.export-no-files")}
                </p>
              )
              : (
                <ul className={styles.fileRows}>
                  {item.files.map((file) => (
                    <li
                      key={file.path}
                      className={listStyles.meta}
                      data-export-file={file.path}
                    >
                      <span className={styles.path}>{file.path}</span>
                      {keptOriginal(file, result.format)
                        ? (
                          <span data-export-kept="">
                            {t("projects.label.export-kept-original")}
                          </span>
                        )
                        : null}
                    </li>
                  ))}
                </ul>
              )}
          </li>
        ))}
      </ul>
      {left.length === 0 ? null : (
        <>
          <h3 className={listStyles.sectionLabel}>
            {t("projects.heading.export-left-out")}
          </h3>
          <ul className={listStyles.rows}>
            {left.map((item) => (
              <li
                key={item.id}
                className={listStyles.rowHead}
                data-export-left-out={item.id}
              >
                <span className={listStyles.rowTitle}>{item.title}</span>
                <span className={listStyles.meta}>
                  {t("projects.label.export-not-picked")}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

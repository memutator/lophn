// project 키워드 검색 탭. 검색어와 폴더 하나로 좁히기, 결과는 경로 순·줄 순, 일치한 부분이 든 snippet을 보인다.
// 결과를 누르면 그 줄에서 파일이 열린다. context 없이 열리고 취소, 건너뛴 파일 안내, 더 보기 단추는 없다.
import { useState } from "react";
import { Input } from "@lophn/design/components";
import { Field, Select } from "@lophn/ui-control";

import { documentTab } from "../phroner-data.ts";
import type { TabSpec } from "../project-window.tsx";
import { type CorpusLine, SEARCH_FOLDERS, searchFiles } from "./file-data.ts";
import styles from "./files.module.css";

/** snippet에서 일치한 부분을 칠한다. */
function Snippet({ text, query }: { text: string; query: string }) {
  const words = query.trim();
  const at = words === ""
    ? -1
    : text.toLowerCase().indexOf(words.toLowerCase());
  if (at === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark>{text.slice(at, at + words.length)}</mark>
      {text.slice(at + words.length)}
    </>
  );
}

function group(hits: readonly CorpusLine[]) {
  const files = new Map<string, CorpusLine[]>();
  for (const hit of hits) {
    files.set(hit.path, [...files.get(hit.path) ?? [], hit]);
  }
  return [...files];
}

export function FileSearch(
  { open, initialQuery = "", initialFolder = "All folders", opened }: {
    open: (tab: TabSpec, other?: boolean) => void;
    initialQuery?: string;
    initialFolder?: string;
    /** 방금 연 결과(경로:줄)를 눌린 모양으로 보인다. */
    opened?: string;
  },
) {
  const [query, setQuery] = useState(initialQuery);
  const [folder, setFolder] = useState(initialFolder);
  const [current, setCurrent] = useState(opened);
  const hits = searchFiles(query, folder);
  const files = group(hits);
  return (
    <div className={styles.finder}>
      <div className={styles.finderColumn}>
        <div className={styles.finderForm}>
          <div className={styles.finderQuery}>
            <Field label="Find in files">
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Text to find"
              />
            </Field>
          </div>
          <div className={styles.finderFolder}>
            <Field label="Folder">
              <Select
                options={SEARCH_FOLDERS.map((name) => ({
                  value: name,
                  label: name,
                }))}
                value={folder}
                onValueChange={setFolder}
              />
            </Field>
          </div>
        </div>
        <p className={styles.finderSummary} aria-live="polite">
          {query.trim() === ""
            ? "Type text to search the files in this project."
            : `${hits.length} ${
              hits.length === 1 ? "match" : "matches"
            } in ${files.length} ${
              files.length === 1 ? "file" : "files"
            } · by path, then line`}
        </p>
        <div className={styles.finderResults}>
          {query.trim() !== "" && hits.length === 0
            ? <p className={styles.finderEmpty}>No matches.</p>
            : files.map(([path, rows]) => (
              <section key={path} className={styles.finderFile}>
                <h2 className={styles.finderPath}>
                  {path}
                  <span className={styles.finderCount}>{rows.length}</span>
                </h2>
                {rows.map((row) => {
                  const id = `${row.path}:${row.line}`;
                  return (
                    <button
                      key={id}
                      type="button"
                      className={styles.finderRow}
                      aria-current={current === id}
                      onClick={() => {
                        setCurrent(id);
                        open(documentTab(row.path, { line: row.line }));
                      }}
                    >
                      <span className={styles.finderLine}>{row.line}</span>
                      <span className={styles.finderSnippet}>
                        <Snippet text={row.text} query={query} />
                      </span>
                    </button>
                  );
                })}
              </section>
            ))}
        </div>
      </div>
    </div>
  );
}

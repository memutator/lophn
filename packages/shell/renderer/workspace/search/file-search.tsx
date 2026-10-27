// project 키워드 검색 화면. 검색어와 폴더 하나로 좁히기, 결과는 경로 순·줄 순(route가 정해 준다),
// 일치한 부분이 든 snippet을 보인다. 결과를 누르면 그 줄에서 파일을 열라고 부르는 쪽에 알린다.
import { useEffect, useRef, useState } from "react";
import { Field, Input, Select } from "@lophn/ui/input";
import { Tooltip } from "@lophn/ui/overlay";
import { t } from "@lophn/wording";

import { rootChoices } from "../sidebar/explorer.tsx";
import type { ProjectFolderView, WorkspaceSource } from "../source.ts";
import styles from "./file-search.module.css";
import type { FileMatch, FileSearchSource } from "./source.ts";

/** 입력이 멈추고 이만큼 기다렸다가 검색한다. */
const WAIT_MS = 300;
/** Select는 빈 값을 못 가져 "모든 폴더"는 이 값이다. */
const ALL = "__all__";

interface FileSearchProps {
  readonly project: string;
  readonly workspace: WorkspaceSource;
  readonly search: FileSearchSource;
  readonly initialQuery?: string;
  /** 절대 경로. 비어 있으면 모든 폴더다. */
  readonly initialFolder?: string;
  /** 처음부터 눌린 모양인 결과 행(`절대 경로:줄`). */
  readonly initialOpened?: string;
  /** path는 절대 경로, line은 1부터다. */
  onOpen(path: string, line: number): void;
  /** 검색어나 폴더가 바뀌었다. 탭이 복원에 쓸 값으로 저장한다. */
  onState?(state: { query: string; folder: string }): void;
}

type Found =
  | { state: "idle" }
  | { state: "done"; matches: readonly FileMatch[] }
  | { state: "failed" };

const absolute = (match: FileMatch) =>
  `${match.folder.replace(/\/+$/, "")}/${match.path}`;

/** snippet에서 route가 알려 준 일치한 부분을 칠한다. */
function Snippet({ match }: { match: FileMatch }) {
  const { text, start, end } = match;
  if (end <= start || end > text.length) return <>{text}</>;
  return (
    <>
      {text.slice(0, start)}
      <mark>{text.slice(start, end)}</mark>
      {text.slice(end)}
    </>
  );
}

function group(matches: readonly FileMatch[]) {
  const files = new Map<string, FileMatch[]>();
  for (const match of matches) {
    const key = absolute(match);
    files.set(key, [...(files.get(key) ?? []), match]);
  }
  return [...files];
}

function folderOptions(folders: readonly ProjectFolderView[], chosen: string) {
  const options = [
    { value: ALL, label: t("file-search.label.all-folders") },
    ...rootChoices(folders)
      .filter((root) => root.found)
      .map((root) => ({
        value: root.path,
        label:
          root.parent === undefined
            ? root.name
            : `${root.parent} / ${root.name}`,
      })),
  ];
  // 복원한 폴더가 이제 없어도 고른 값은 그대로 보인다.
  return chosen === ALL || options.some((item) => item.value === chosen)
    ? options
    : [...options, { value: chosen, label: chosen }];
}

export function FileSearch(props: FileSearchProps) {
  const { project, workspace, search, onOpen, onState } = props;
  const [query, setQuery] = useState(props.initialQuery ?? "");
  // 입력이 멈춘 뒤의 검색어. 검색은 이 값으로 돈다.
  const [settled, setSettled] = useState(query);
  const [folder, setFolder] = useState(
    props.initialFolder === undefined || props.initialFolder === ""
      ? ALL
      : props.initialFolder,
  );
  const [folders, setFolders] = useState<readonly ProjectFolderView[]>([]);
  const [found, setFound] = useState<Found>({ state: "idle" });
  const [current, setCurrent] = useState(props.initialOpened);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    let live = true;
    void workspace.project(project).then((read) => {
      if (live && read.ok) setFolders(read.value.folders);
    });
    return () => {
      live = false;
    };
  }, [workspace, project]);

  useEffect(() => () => clearTimeout(timer.current), []);

  useEffect(() => {
    if (settled.trim() === "") {
      setFound({ state: "idle" });
      return;
    }
    let live = true;
    void search
      .search({
        project,
        query: settled,
        ...(folder === ALL ? {} : { folder }),
      })
      .then((read) => {
        if (!live) return;
        setFound(
          read.ok
            ? { state: "done", matches: read.value }
            : { state: "failed" },
        );
      });
    return () => {
      live = false;
    };
  }, [search, project, settled, folder]);

  const changeQuery = (next: string) => {
    setQuery(next);
    onState?.({ query: next, folder: folder === ALL ? "" : folder });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setSettled(next), WAIT_MS);
  };
  const changeFolder = (next: string) => {
    setFolder(next);
    onState?.({ query, folder: next === ALL ? "" : next });
  };

  const matches =
    found.state === "done" && query.trim() !== "" ? found.matches : [];
  const files = group(matches);
  return (
    <div className={styles.finder}>
      <div className={styles.finderColumn}>
        <div className={styles.finderForm}>
          <div className={styles.finderQuery}>
            <Field label={t("file-search.label.query")}>
              <Input
                value={query}
                onChange={(event) => changeQuery(event.target.value)}
                placeholder={t("file-search.label.query-hint")}
              />
            </Field>
          </div>
          <div className={styles.finderFolder}>
            <Field label={t("file-search.label.folder")}>
              <Select
                options={folderOptions(folders, folder)}
                value={folder}
                onValueChange={changeFolder}
              />
            </Field>
          </div>
        </div>
        <p className={styles.finderSummary} aria-live="polite">
          {query.trim() === ""
            ? t("file-search.notice.type-text")
            : found.state === "failed"
              ? t("file-search.notice.unavailable")
              : found.state === "done"
                ? t("file-search.label.matches", {
                    matches: matches.length,
                    files: files.length,
                  })
                : ""}
        </p>
        <div className={styles.finderResults}>
          {found.state === "done" &&
          matches.length === 0 &&
          query.trim() !== "" ? (
            <p className={styles.finderEmpty}>
              {t("file-search.notice.no-matches")}
            </p>
          ) : (
            files.map(([path, rows]) => (
              <section key={path} className={styles.finderFile}>
                <Tooltip content={path}>
                  <h2 className={styles.finderPath}>
                    {rows[0].path}
                    <span className={styles.finderCount}>{rows.length}</span>
                  </h2>
                </Tooltip>
                {rows.map((row) => {
                  const id = `${path}:${row.line}`;
                  return (
                    <button
                      key={id}
                      type="button"
                      className={styles.finderRow}
                      aria-current={current === id}
                      onClick={() => {
                        setCurrent(id);
                        onOpen(path, row.line);
                      }}
                    >
                      <span className={styles.finderLine}>{row.line}</span>
                      <span className={styles.finderSnippet}>
                        <Snippet match={row} />
                      </span>
                    </button>
                  );
                })}
              </section>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

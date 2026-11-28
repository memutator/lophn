// Commits 섹션: 지금 브랜치의 최근 커밋 50개씩. 누르면 그 커밋의 바뀐 파일이 펼쳐지고, 파일은 git_diff(parent..commit)로 연다.
// 원격 도달 표시는 upstream보다 앞선 수(ahead)로 정한다: 맨 위 ahead개가 아직 push되지 않은 커밋이다.
import { formatRelativeTime, t } from "@lophn/i18n";
import { Menu, MenuIcon, Tooltip } from "@lophn/ui/overlay";
import { FileIcon } from "@lophn/ui/primitives";
import { systemClipboard } from "@lophn/ui/shared";
import { type MouseEvent, useEffect, useState } from "react";
import type { SourceControlCommit } from "../../../../protocol/projects/source-control.ts";
import { PanelEmpty } from "../../shell/panel-rows.tsx";
import { sourceControlIcons, workspaceIcons } from "../../icons/mod.ts";
import type {
  GitFailure,
  SourceControlShowValue,
  SourceControlSource,
} from "../worktrees/source.ts";
import type { SourceControlTarget } from "../../../../protocol/projects/source-control.ts";
import { ErrorCard } from "./error-card.tsx";
import { baseName } from "./model.ts";
import styles from "./source-control.module.css";

const PAGE = 50;
const MAX_REFS = 2;

export interface HistoryProps {
  readonly source: SourceControlSource;
  readonly target: SourceControlTarget;
  /** 다시 읽을 때가 바뀌었다(HEAD가 바뀜, 커밋, pull). */
  readonly head: string | null;
  /** upstream이 없으면 null(모두 push되지 않은 것으로 본다). */
  readonly ahead: number | null;
  readonly hasUpstream: boolean;
  readonly onOpenFile: (
    sha: string,
    path: string,
    status: string,
    keep: boolean,
  ) => void;
  readonly onBranchFrom: (sha: string) => void;
  readonly readOnly: boolean;
}

function refsOf(commit: SourceControlCommit): string[] {
  return commit.refs
    .map((ref) => ref.replace(/^HEAD -> /, "").replace(/^tag: /, ""))
    .filter((ref) => ref !== "HEAD" && ref !== "");
}

export function History(props: HistoryProps) {
  const [commits, setCommits] = useState<readonly SourceControlCommit[]>([]);
  const [more, setMore] = useState(false);
  const [failure, setFailure] = useState<GitFailure | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [detail, setDetail] = useState<SourceControlShowValue | null>(null);
  const [menu, setMenu] = useState<{
    commit: SourceControlCommit;
    x: number;
    y: number;
  } | null>(null);
  const targetKey = JSON.stringify(props.target);

  const load = async (skip: number) => {
    const res = await props.source.log(props.target, { limit: PAGE, skip });
    setLoaded(true);
    if (!res.ok) {
      setFailure(res.error);
      return;
    }
    setFailure(null);
    setCommits((prev) =>
      skip === 0 ? res.value.commits : [...prev, ...res.value.commits],
    );
    setMore(res.value.commits.length === PAGE);
  };

  useEffect(() => {
    setOpen(null);
    setDetail(null);
    void load(0);
  }, [targetKey, props.head]);

  const toggle = async (sha: string) => {
    if (open === sha) {
      setOpen(null);
      return;
    }
    setOpen(sha);
    setDetail(null);
    const res = await props.source.show(props.target, sha);
    if (res.ok) setDetail(res.value);
    else setFailure(res.error);
  };

  const copyMessage = async (commit: SourceControlCommit) => {
    const res = await props.source.show(props.target, commit.sha);
    const body = res.ok ? res.value.commit.body : "";
    void systemClipboard.writeText(
      body === "" ? commit.subject : `${commit.subject}\n\n${body}`,
    );
  };

  if (failure !== null && commits.length === 0) {
    return <ErrorCard failure={failure} onDismiss={() => setFailure(null)} />;
  }
  if (loaded && commits.length === 0) {
    return <PanelEmpty>{t("source-control.empty.no-commits")}</PanelEmpty>;
  }
  const now = new Date();
  return (
    <div className={styles.history} data-sc-history="">
      {commits.map((commit, index) => {
        const pushed =
          props.hasUpstream && props.ahead !== null && index >= props.ahead;
        const refs = refsOf(commit);
        return (
          <div key={commit.sha}>
            <div
              role="button"
              tabIndex={0}
              className={styles.commitRow}
              data-sc-commit-row={commit.sha}
              aria-expanded={open === commit.sha}
              onClick={() => void toggle(commit.sha)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  void toggle(commit.sha);
                }
              }}
              onContextMenu={(event: MouseEvent) => {
                event.preventDefault();
                setMenu({ commit, x: event.clientX, y: event.clientY });
              }}
            >
              <Tooltip
                content={
                  pushed
                    ? t("source-control.label.pushed")
                    : t("source-control.label.not-pushed")
                }
              >
                <span
                  className={styles.pushMark}
                  data-pushed={pushed || undefined}
                />
              </Tooltip>
              <Tooltip content={commit.subject}>
                <span className={styles.commitSubject}>{commit.subject}</span>
              </Tooltip>
              {refs.slice(0, MAX_REFS).map((ref) => (
                <span key={ref} className={styles.refBadge}>
                  {ref}
                </span>
              ))}
              {refs.length > MAX_REFS ? (
                <Tooltip content={refs.slice(MAX_REFS).join(", ")}>
                  <span className={styles.refBadge}>
                    {t("source-control.label.more-refs", {
                      count: refs.length - MAX_REFS,
                    })}
                  </span>
                </Tooltip>
              ) : null}
              <span className={styles.commitMeta}>
                {commit.short_sha} · {commit.author_name} ·{" "}
                {commit.authored_at === ""
                  ? ""
                  : formatRelativeTime(new Date(commit.authored_at), now)}
              </span>
            </div>
            {open === commit.sha &&
            detail !== null &&
            detail.commit.sha === commit.sha ? (
              <div className={styles.commitFiles}>
                {detail.files.map((file) => (
                  <div
                    key={file.path}
                    role="button"
                    tabIndex={0}
                    className={styles.fileRow}
                    data-sc-commit-file={file.path}
                    onClick={() =>
                      props.onOpenFile(
                        commit.sha,
                        file.path,
                        file.status,
                        false,
                      )
                    }
                    onDoubleClick={() =>
                      props.onOpenFile(commit.sha, file.path, file.status, true)
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        props.onOpenFile(
                          commit.sha,
                          file.path,
                          file.status,
                          true,
                        );
                      }
                    }}
                  >
                    <span className={styles.fileIcon}>
                      <FileIcon name={baseName(file.path)} size={14} />
                    </span>
                    <span className={styles.fileName}>
                      {baseName(file.path)}
                    </span>
                    <span className={styles.fileDir}>
                      {file.path.includes("/")
                        ? file.path.slice(0, file.path.lastIndexOf("/"))
                        : ""}
                    </span>
                    <span className={styles.stat}>
                      {file.additions ? (
                        <span className={styles.statAdd}>
                          +{file.additions}
                        </span>
                      ) : null}
                      {file.deletions ? (
                        <span className={styles.statDel}>
                          -{file.deletions}
                        </span>
                      ) : null}
                    </span>
                    <span
                      className={styles.letter}
                      data-tone={toneOf(file.status)}
                    >
                      {file.status.slice(0, 1)}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
      {more ? (
        <button
          type="button"
          className={styles.loadMore}
          onClick={() => void load(commits.length)}
        >
          {t("source-control.button.load-more")}
        </button>
      ) : null}
      {menu === null ? null : (
        <Menu
          open
          onOpenChange={(value) => {
            if (!value) setMenu(null);
          }}
          trigger={
            <span
              className={styles.menuAnchor}
              style={{ left: menu.x, top: menu.y }}
            />
          }
          returnFocus={false}
          items={[
            {
              id: "copy-sha",
              label: t("source-control.button.copy-sha"),
              leading: <MenuIcon icon={workspaceIcons.copy} />,
            },
            {
              id: "copy-message",
              label: t("source-control.button.copy-message"),
            },
            ...(props.readOnly
              ? []
              : [
                  {
                    id: "branch-from",
                    label: t("source-control.button.branch-from-commit"),
                    leading: <MenuIcon icon={sourceControlIcons.newBranch} />,
                    separatorBefore: true,
                  },
                ]),
          ]}
          onSelect={(id) => {
            const commit = menu.commit;
            setMenu(null);
            if (id === "copy-sha") void systemClipboard.writeText(commit.sha);
            else if (id === "copy-message") void copyMessage(commit);
            else if (id === "branch-from") props.onBranchFrom(commit.sha);
          }}
        />
      )}
    </div>
  );
}

function toneOf(status: string): string {
  const letter = status.slice(0, 1);
  return letter === "A"
    ? "added"
    : letter === "D"
      ? "deleted"
      : letter === "R"
        ? "renamed"
        : "modified";
}

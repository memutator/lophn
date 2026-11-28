// 브랜치 바: 지금 브랜치(또는 Detached HEAD) 팝오버와 ↑N ↓M, Fetch·Pull·Push(Publish Branch).
// 다른 lophn 체크아웃이 쓰는 브랜치는 고르면 그 체크아웃으로 대상을 옮기고, 바깥 worktree가 쓰는 브랜치는 끈다.
// 바꾸기는 저절로 stash 하지 않는다: core가 dirty·도는 agent turn을 거절하면 그 이유를 보인다.
import { t } from "@lophn/i18n";
import { Menu, Popover, Tooltip } from "@lophn/ui/overlay";
import { Icon, IconButton } from "@lophn/ui/primitives";
import { iconPixels, systemClipboard } from "@lophn/ui/shared";
import { useState } from "react";
import type { SourceControlBranch } from "../../../../protocol/projects/source-control.ts";
import {
  shellIcons,
  sourceControlIcons,
  workspaceIcons,
} from "../../icons/mod.ts";
import type {
  CheckoutRef,
  SourceControlSource,
  SourceControlStatusValue,
} from "../worktrees/source.ts";
import type { SourceControlTarget } from "../../../../protocol/projects/source-control.ts";
import styles from "./source-control.module.css";

const samePath = (a: string, b: string) =>
  a.replace(/\/+$/, "") === b.replace(/\/+$/, "");

export interface BranchBarProps {
  readonly status: SourceControlStatusValue;
  readonly source: SourceControlSource;
  readonly target: SourceControlTarget;
  readonly readOnly: boolean;
  readonly busy: boolean;
  /** 이 project가 아는 체크아웃(등록 폴더와 lophn worktree)의 경로. 다른 체크아웃이 쓰는 브랜치를 그리로 옮긴다. */
  readonly checkouts: readonly {
    readonly path: string;
    readonly ref: CheckoutRef;
  }[];
  readonly onJump: (checkout: CheckoutRef) => void;
  readonly onSwitch: (branch: string) => void;
  readonly onCreate: (name: string | null) => void;
  readonly onRename: (branch: string) => void;
  readonly onDelete: (branch: string) => void;
  readonly onSync: (op: "fetch" | "pull" | "push" | "publish") => void;
}

export function BranchBar(props: BranchBarProps) {
  const { status } = props;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [branches, setBranches] = useState<
    readonly SourceControlBranch[] | null
  >(null);
  const shortSha = status.head_sha?.slice(0, 7) ?? "";
  const label =
    status.branch ??
    (status.unborn
      ? "—"
      : t("source-control.label.detached", { sha: shortSha }));

  const load = async () => {
    const res = await props.source.branches(props.target, {
      includeRemote: true,
    });
    setBranches(res.ok ? res.value.branches : []);
  };

  const needle = query.trim().toLowerCase();
  const shown = (branches ?? []).filter(
    (branch) => needle === "" || branch.name.toLowerCase().includes(needle),
  );
  const local = shown.filter((branch) => !branch.remote);
  const remote = shown.filter((branch) => branch.remote);
  const exact = (branches ?? []).some(
    (branch) => !branch.remote && branch.name === query.trim(),
  );

  const owner = (branch: SourceControlBranch) => {
    if (branch.current || branch.worktree_path === null) return null;
    const known = props.checkouts.find((one) =>
      samePath(one.path, branch.worktree_path!),
    );
    return known === undefined
      ? { kind: "external" as const, path: branch.worktree_path }
      : { kind: "known" as const, ref: known.ref };
  };

  const pick = (branch: SourceControlBranch) => {
    const used = owner(branch);
    if (used?.kind === "external") return;
    setOpen(false);
    if (used?.kind === "known") {
      props.onJump(used.ref);
      return;
    }
    if (branch.current) return;
    // remote 브랜치는 이름에서 remote를 떼고 바꾸면 git이 tracking 브랜치를 만든다.
    props.onSwitch(
      branch.remote
        ? branch.name.slice(branch.name.indexOf("/") + 1)
        : branch.name,
    );
  };

  const row = (branch: SourceControlBranch) => {
    const used = owner(branch);
    const disabled =
      used?.kind === "external" ||
      (props.readOnly && used === null && !branch.current);
    const body = (
      <div
        key={branch.name}
        role="option"
        aria-selected={branch.current}
        aria-disabled={disabled || undefined}
        tabIndex={disabled ? -1 : 0}
        className={styles.branchRow}
        data-sc-branch={branch.name}
        data-disabled={disabled || undefined}
        onClick={() => {
          if (!disabled) pick(branch);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !disabled) pick(branch);
        }}
      >
        <span className={styles.branchCheck}>
          {branch.current ? (
            <Icon
              icon={sourceControlIcons.resolved}
              pixels={iconPixels("small")}
            />
          ) : null}
        </span>
        <span className={styles.branchName}>{branch.name}</span>
        {branch.remote ? (
          <span className={styles.refBadge}>
            {t("source-control.label.badge-remote")}
          </span>
        ) : null}
        {used?.kind === "known" ? (
          <span className={styles.refBadge}>
            {t("source-control.label.badge-worktree")}
          </span>
        ) : null}
        {branch.current ? (
          <IconButton
            size="sm"
            icon={workspaceIcons.copy}
            label={t("source-control.button.copy-branch")}
            onClick={(event) => {
              event.stopPropagation();
              void systemClipboard.writeText(branch.name);
            }}
          />
        ) : null}
        {!branch.remote &&
        !branch.current &&
        used === null &&
        !props.readOnly ? (
          <Menu
            trigger={
              <IconButton
                size="sm"
                icon={shellIcons.more}
                label={t("source-control.label.actions")}
                onClick={(event) => event.stopPropagation()}
              />
            }
            items={[
              { id: "rename", label: t("source-control.button.rename-branch") },
              { id: "delete", label: t("source-control.button.delete-branch") },
            ]}
            onSelect={(id) => {
              setOpen(false);
              if (id === "rename") props.onRename(branch.name);
              else props.onDelete(branch.name);
            }}
          />
        ) : null}
      </div>
    );
    if (used === null) return body;
    return (
      <Tooltip
        key={branch.name}
        content={
          used.kind === "external"
            ? t("source-control.note.checked-out-in", { path: used.path })
            : t("source-control.note.open-worktree")
        }
      >
        {body}
      </Tooltip>
    );
  };

  const syncBlocked = !status.has_remote
    ? t("source-control.note.no-remote")
    : status.unborn
      ? t("source-control.note.unborn")
      : status.detached
        ? t("source-control.note.detached")
        : null;
  const writeBlocked = props.readOnly
    ? t("source-control.notice.read-only")
    : null;
  const syncButton = (
    op: "fetch" | "pull" | "push" | "publish",
    icon: (typeof sourceControlIcons)[keyof typeof sourceControlIcons],
    text: string,
    blocked: string | null,
  ) => (
    <Tooltip key={op} content={blocked ?? text}>
      <IconButton
        size="sm"
        icon={icon}
        label={text}
        disabled={blocked !== null || props.busy}
        data-sc-sync={op}
        onClick={() => props.onSync(op)}
      />
    </Tooltip>
  );

  return (
    <div className={styles.branchBar}>
      <Popover
        open={open}
        onOpenChange={(value) => {
          setOpen(value);
          if (value) {
            setQuery("");
            void load();
          }
        }}
        placement="corner"
        trigger={
          <button
            type="button"
            className={styles.branchButton}
            aria-label={t("source-control.label.branch-picker")}
            data-sc-branch-bar=""
          >
            <Icon
              icon={sourceControlIcons.branch}
              pixels={iconPixels("small")}
            />
            <span className={styles.branchLabel}>{label}</span>
          </button>
        }
      >
        <div className={styles.branchPopover}>
          <input
            className={styles.filterInput}
            value={query}
            placeholder={t("source-control.label.search-branches")}
            aria-label={t("source-control.label.search-branches")}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") return;
              event.stopPropagation();
              if (
                event.key === "Enter" &&
                query.trim() !== "" &&
                !exact &&
                !props.readOnly
              ) {
                setOpen(false);
                props.onCreate(query.trim());
              }
            }}
          />
          {props.readOnly ? null : (
            <div
              role="button"
              tabIndex={0}
              className={styles.branchRow}
              data-sc-branch-new=""
              onClick={() => {
                setOpen(false);
                props.onCreate(
                  query.trim() === "" || exact ? null : query.trim(),
                );
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  setOpen(false);
                  props.onCreate(
                    query.trim() === "" || exact ? null : query.trim(),
                  );
                }
              }}
            >
              <span className={styles.branchCheck}>
                <Icon
                  icon={sourceControlIcons.newBranch}
                  pixels={iconPixels("small")}
                />
              </span>
              <span className={styles.branchName}>
                {query.trim() === "" || exact
                  ? t("source-control.button.new-branch")
                  : t("source-control.button.create-branch-named", {
                      name: query.trim(),
                    })}
              </span>
            </div>
          )}
          <div role="listbox" className={styles.branchList}>
            {local.length === 0 ? null : (
              <div className={styles.branchHeading}>
                {t("source-control.heading.local")}
              </div>
            )}
            {local.map(row)}
            {remote.length === 0 ? null : (
              <div className={styles.branchHeading}>
                {t("source-control.heading.remote")}
              </div>
            )}
            {remote.map(row)}
          </div>
        </div>
      </Popover>
      <span className={styles.syncCounts}>
        {status.ahead ? (
          <span
            aria-label={t("source-control.label.ahead", {
              count: status.ahead,
            })}
          >
            ↑{status.ahead}
          </span>
        ) : null}
        {status.behind ? (
          <span
            aria-label={t("source-control.label.behind", {
              count: status.behind,
            })}
          >
            ↓{status.behind}
          </span>
        ) : null}
      </span>
      <span className={styles.syncButtons}>
        {syncButton(
          "fetch",
          sourceControlIcons.fetch,
          t("source-control.button.fetch"),
          writeBlocked ??
            (status.has_remote ? null : t("source-control.note.no-remote")),
        )}
        {syncButton(
          "pull",
          sourceControlIcons.pull,
          t("source-control.button.pull"),
          writeBlocked ?? syncBlocked,
        )}
        {status.upstream === null && !status.detached
          ? syncButton(
              "publish",
              sourceControlIcons.publish,
              t("source-control.button.publish"),
              writeBlocked ?? syncBlocked,
            )
          : syncButton(
              "push",
              sourceControlIcons.push,
              t("source-control.button.push"),
              writeBlocked ?? syncBlocked,
            )}
      </span>
    </div>
  );
}

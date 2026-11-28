// worktree 만들기·지우기·이름 바꾸기 창. 열린 창 하나를 이 hook이 들고, workspace-window가 `element`를 그리고
// 여는 함수들을 WorktreeUi context에 싣는다. Explorer, + 메뉴, Ctrl+K가 같은 창을 연다.
import { t } from "@lophn/i18n";
import { Checkbox, Field, Input, Select } from "@lophn/ui/input";
import { Dialog } from "@lophn/ui/overlay";
import { Button } from "@lophn/ui/primitives";
import { type ReactNode, useEffect, useState } from "react";
import type {
  WorktreeEntry,
  WorktreeRemovePreflight,
} from "../../../../protocol/projects/worktrees.ts";
import type { AfterCreate } from "./context.tsx";
import type { GitFailure } from "./source.ts";
import { branchLabelOf, type ProjectWorktrees } from "./use-worktrees.ts";
import styles from "./dialogs.module.css";

export interface WorktreeDialogDeps {
  readonly project: string;
  /** project 등록 폴더(원래 폴더). 여럿이면 만들기 창이 고르게 한다. */
  readonly folders: readonly string[];
  readonly worktrees: ProjectWorktrees;
  /** 다른 컴퓨터이고 쓰기 허락이 없다. 창을 열지 않는다. */
  readonly readOnly: boolean;
  /** Project Command id의 이름. 모르면 null(id를 보인다). */
  readonly commandName?: (id: string) => string | null;
}

export interface WorktreeDialogs {
  openCreate(options?: {
    readonly folder?: string;
    readonly onCreated?: AfterCreate;
  }): void;
  openRemove(worktree: string): void;
  openRename(worktree: string): void;
  /** 열린 창. 창 아무 데나 한 번 그린다. */
  readonly element: ReactNode;
}

type Open =
  | {
      readonly kind: "create";
      readonly folder?: string;
      readonly onCreated?: AfterCreate;
    }
  | { readonly kind: "remove"; readonly worktree: string }
  | { readonly kind: "rename"; readonly worktree: string };

export function useWorktreeDialogs(deps: WorktreeDialogDeps): WorktreeDialogs {
  const [open, setOpen] = useState<Open | null>(null);
  const close = () => setOpen(null);
  const entry =
    open !== null && open.kind !== "create"
      ? deps.worktrees.byId(open.worktree)
      : undefined;
  let element: ReactNode = null;
  if (open?.kind === "create") {
    element = (
      <CreateDialog
        deps={deps}
        folder={open.folder}
        onCreated={open.onCreated}
        onClose={close}
      />
    );
  } else if (open?.kind === "remove" && entry !== undefined) {
    element = <RemoveDialog deps={deps} entry={entry} onClose={close} />;
  } else if (open?.kind === "rename" && entry !== undefined) {
    element = <RenameDialog deps={deps} entry={entry} onClose={close} />;
  }
  return {
    openCreate: (options) => {
      if (deps.readOnly) return;
      setOpen({ kind: "create", ...options });
    },
    openRemove: (worktree) => {
      if (deps.readOnly) return;
      setOpen({ kind: "remove", worktree });
    },
    openRename: (worktree) => {
      if (deps.readOnly) return;
      setOpen({ kind: "rename", worktree });
    },
    element,
  };
}

const baseName = (path: string) =>
  path
    .replace(/[/\\]+$/, "")
    .split(/[/\\]/)
    .at(-1) ?? path;

function failureText(error: GitFailure): string {
  return error.reason === undefined
    ? error.message
    : t("worktree.error.failed-reason", {
        message: error.message,
        reason: error.reason,
      });
}

function Failure({ error }: { error: GitFailure | null }) {
  if (error === null) return null;
  return (
    <div className={styles.error} role="alert" data-worktree-error="">
      {failureText(error)}
    </div>
  );
}

function CreateDialog({
  deps,
  folder,
  onCreated,
  onClose,
}: {
  deps: WorktreeDialogDeps;
  folder: string | undefined;
  onCreated: AfterCreate | undefined;
  onClose: () => void;
}) {
  const [from, setFrom] = useState(folder ?? deps.folders[0] ?? "");
  const [base, setBase] = useState("");
  const [branch, setBranch] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<GitFailure | null>(null);
  const [warnings, setWarnings] = useState<readonly string[] | null>(null);
  const settings = deps.worktrees.settings;
  const commandLabel = (id: string | null) =>
    id === null ? null : (deps.commandName?.(id) ?? id);
  const setup =
    settings.run_setup && settings.setup_command !== null
      ? commandLabel(settings.setup_command)
      : null;

  const submit = async () => {
    const source = deps.worktrees.source;
    if (source === null || busy) return;
    setBusy(true);
    setError(null);
    const res = await source.create({
      project: deps.project,
      mode: "new_branch",
      ...(deps.folders.length > 1 && from !== "" ? { folder: from } : {}),
      ...(base.trim() === "" ? {} : { base_ref: base.trim() }),
      ...(branch.trim() === "" ? {} : { branch: branch.trim() }),
      ...(label.trim() === "" ? {} : { label: label.trim() }),
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    deps.worktrees.reload();
    onCreated?.(res.value.record);
    // 경고가 있으면(fetch 실패 뒤 로컬 ref, 복사 상한, setup 실패) 창에 남겨 보인다.
    if (res.value.warnings.length > 0) setWarnings(res.value.warnings);
    else onClose();
  };

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
      title={t("worktree.title.create")}
      actions={
        warnings !== null ? (
          <Button variant="primary" onClick={onClose}>
            {t("common.button.close")}
          </Button>
        ) : (
          <>
            <Button onClick={onClose} disabled={busy}>
              {t("common.button.cancel")}
            </Button>
            <Button
              variant="primary"
              disabled={busy || deps.worktrees.source === null}
              onClick={() => void submit()}
              data-worktree-create-submit=""
            >
              {busy
                ? t("worktree.button.creating")
                : t("worktree.button.create")}
            </Button>
          </>
        )
      }
    >
      {warnings !== null ? (
        <div className={styles.body} data-worktree-created="">
          <p>{t("worktree.notice.created-with-warnings")}</p>
          <ul className={styles.list}>
            {warnings.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      ) : (
        <form
          className={styles.body}
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {deps.folders.length > 1 ? (
            <Field label={t("worktree.label.source-folder")}>
              <Select
                value={from}
                onValueChange={setFrom}
                disabled={busy}
                options={deps.folders.map((path) => ({
                  value: path,
                  label: baseName(path),
                }))}
              />
            </Field>
          ) : null}
          <Field
            label={t("worktree.label.base-ref")}
            help={t("worktree.note.base-ref")}
          >
            <Input
              value={base}
              placeholder="origin/main"
              disabled={busy}
              spellCheck={false}
              onChange={(event) => setBase(event.target.value)}
            />
          </Field>
          <Field
            label={t("worktree.label.branch")}
            help={t("worktree.note.branch-auto")}
          >
            <Input
              value={branch}
              placeholder="wt/…"
              disabled={busy}
              spellCheck={false}
              onChange={(event) => setBranch(event.target.value)}
            />
          </Field>
          <Field label={t("worktree.label.label")}>
            <Input
              value={label}
              maxLength={80}
              disabled={busy}
              onChange={(event) => setLabel(event.target.value)}
            />
          </Field>
          <div className={styles.summary} data-worktree-prep="">
            <span>
              {settings.copy_patterns.length === 0
                ? t("worktree.note.copy-none")
                : t("worktree.note.copy-patterns", {
                    patterns: settings.copy_patterns.join(", "),
                  })}
            </span>
            <span>
              {setup === null
                ? t("worktree.note.setup-none")
                : t("worktree.note.setup", { command: setup })}
            </span>
          </div>
          {busy ? (
            <div className={styles.progress} role="status">
              {t("worktree.notice.creating")}
            </div>
          ) : null}
          <Failure error={error} />
          {/* Enter로 제출한다. */}
          <button type="submit" hidden />
        </form>
      )}
    </Dialog>
  );
}

function RemoveDialog({
  deps,
  entry,
  onClose,
}: {
  deps: WorktreeDialogDeps;
  entry: WorktreeEntry;
  onClose: () => void;
}) {
  const adopted = entry.record.provenance === "adopted";
  const [preflight, setPreflight] = useState<WorktreeRemovePreflight | null>(
    null,
  );
  const [loadError, setLoadError] = useState<GitFailure | null>(null);
  const [force, setForce] = useState(false);
  const [stopSessions, setStopSessions] = useState(false);
  const [deleteBranch, setDeleteBranch] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<GitFailure | null>(null);
  const [preserved, setPreserved] = useState<{
    readonly name: string;
    readonly reason: string;
  } | null>(null);
  const id = entry.record.id;

  useEffect(() => {
    const source = deps.worktrees.source;
    if (adopted || source === null) return;
    let alive = true;
    void source.preflight(id).then((res) => {
      if (!alive) return;
      if (res.ok) setPreflight(res.value.preflight);
      else setLoadError(res.error);
    });
    return () => {
      alive = false;
    };
  }, [id, adopted, deps.worktrees.source]);

  const blocked = preflight !== null && preflight.hard_blocks.length > 0;
  const ready =
    adopted ||
    (preflight !== null &&
      !blocked &&
      (!preflight.requires_force || force) &&
      (!preflight.requires_stop_sessions || stopSessions));

  const submit = async () => {
    const source = deps.worktrees.source;
    if (source === null || busy || !ready) return;
    setBusy(true);
    setError(null);
    const res = await source.remove({
      worktree: id,
      ...(force ? { force: true } : {}),
      ...(stopSessions ? { stop_sessions: true } : {}),
      ...(deleteBranch ? { delete_branch: true } : {}),
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    deps.worktrees.reload();
    if (res.value.preserved_branch !== null) {
      setPreserved(res.value.preserved_branch);
    } else onClose();
  };

  const name = branchLabelOf(entry);
  const done = preserved !== null;
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
      title={
        adopted
          ? t("worktree.title.untrack", { name })
          : t("worktree.title.remove", { name })
      }
      actions={
        done ? (
          <Button variant="primary" onClick={onClose}>
            {t("common.button.close")}
          </Button>
        ) : (
          <>
            <Button onClick={onClose} disabled={busy}>
              {t("common.button.cancel")}
            </Button>
            <Button
              variant="danger"
              disabled={busy || !ready}
              onClick={() => void submit()}
              data-worktree-remove-submit=""
            >
              {adopted
                ? t("worktree.button.untrack")
                : busy
                  ? t("worktree.button.removing")
                  : t("worktree.button.remove")}
            </Button>
          </>
        )
      }
    >
      <div className={styles.body} data-worktree-remove={id}>
        {done ? (
          <p data-worktree-preserved="">
            {t("worktree.notice.branch-preserved", {
              branch: preserved.name,
              reason: preserved.reason,
            })}
          </p>
        ) : adopted ? (
          <p>{t("worktree.notice.untrack", { path: entry.record.path })}</p>
        ) : (
          <>
            <dl className={styles.facts}>
              <dt>{t("worktree.label.path")}</dt>
              <dd className={styles.path}>{entry.record.path}</dd>
              <dt>{t("worktree.label.branch")}</dt>
              <dd>{name}</dd>
              {preflight === null ? null : (
                <>
                  <dt>{t("worktree.label.changes")}</dt>
                  <dd>
                    {t("worktree.label.changes-count", {
                      changed:
                        preflight.staged_count +
                        preflight.unstaged_count +
                        preflight.conflicted_count,
                      untracked: preflight.untracked_count,
                    })}
                  </dd>
                  <dt>{t("worktree.label.unpushed")}</dt>
                  <dd>
                    {preflight.unpushed_commits === null
                      ? t("worktree.label.unpushed-unknown")
                      : String(preflight.unpushed_commits)}
                  </dd>
                </>
              )}
            </dl>
            {preflight === null && loadError === null ? (
              <p role="status">{t("worktree.notice.checking")}</p>
            ) : null}
            <Failure error={loadError} />
            {preflight === null ? null : (
              <>
                {preflight.hard_blocks.map((block) => (
                  <p key={block} className={styles.error} role="alert">
                    {block === "worktree_locked"
                      ? t("worktree.error.locked")
                      : block === "nested_worktree"
                        ? t("worktree.error.nested")
                        : t("worktree.error.unsafe-path")}
                  </p>
                ))}
                {preflight.has_submodules ? (
                  <p>{t("worktree.notice.submodules")}</p>
                ) : null}
                {preflight.unpushed_commits !== null &&
                preflight.unpushed_commits > 0 ? (
                  <p>{t("worktree.notice.unpushed")}</p>
                ) : null}
                {blocked ? null : (
                  <div className={styles.checks}>
                    {preflight.requires_stop_sessions ? (
                      <Checkbox
                        label={t("worktree.label.stop-sessions", {
                          count:
                            preflight.active_sessions.length +
                            preflight.active_terminals.length,
                        })}
                        checked={stopSessions}
                        onCheckedChange={setStopSessions}
                        disabled={busy}
                      />
                    ) : null}
                    {preflight.requires_force ? (
                      <Checkbox
                        label={t("worktree.label.force")}
                        checked={force}
                        onCheckedChange={setForce}
                        disabled={busy}
                      />
                    ) : null}
                    {preflight.deletable_branch ? (
                      <Checkbox
                        label={t("worktree.label.delete-branch")}
                        checked={deleteBranch}
                        onCheckedChange={setDeleteBranch}
                        disabled={busy}
                      />
                    ) : null}
                  </div>
                )}
              </>
            )}
          </>
        )}
        <Failure error={error} />
      </div>
    </Dialog>
  );
}

function RenameDialog({
  deps,
  entry,
  onClose,
}: {
  deps: WorktreeDialogDeps;
  entry: WorktreeEntry;
  onClose: () => void;
}) {
  const currentBranch = entry.status.branch ?? entry.record.branch;
  const [label, setLabel] = useState(entry.record.label);
  const [branch, setBranch] = useState(currentBranch ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<GitFailure | null>(null);
  const labelChanged =
    label.trim() !== "" && label.trim() !== entry.record.label;
  const branchChanged =
    currentBranch !== null &&
    branch.trim() !== "" &&
    branch.trim() !== currentBranch;

  const submit = async () => {
    const source = deps.worktrees.source;
    if (source === null || busy || (!labelChanged && !branchChanged)) return;
    setBusy(true);
    setError(null);
    const res = await source.rename({
      worktree: entry.record.id,
      ...(labelChanged ? { label: label.trim() } : {}),
      ...(branchChanged ? { branch: branch.trim(), rename_branch: true } : {}),
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    deps.worktrees.reload();
    onClose();
  };

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
      title={t("worktree.title.rename", { name: branchLabelOf(entry) })}
      actions={
        <>
          <Button onClick={onClose} disabled={busy}>
            {t("common.button.cancel")}
          </Button>
          <Button
            variant="primary"
            disabled={busy || (!labelChanged && !branchChanged)}
            onClick={() => void submit()}
          >
            {t("worktree.button.rename")}
          </Button>
        </>
      }
    >
      <form
        className={styles.body}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Field label={t("worktree.label.label")}>
          <Input
            value={label}
            maxLength={80}
            disabled={busy}
            onChange={(event) => setLabel(event.target.value)}
          />
        </Field>
        {currentBranch === null ? null : (
          <Field
            label={t("worktree.label.branch")}
            help={t("worktree.note.rename-branch")}
          >
            <Input
              value={branch}
              disabled={busy}
              spellCheck={false}
              onChange={(event) => setBranch(event.target.value)}
            />
          </Field>
        )}
        <Failure error={error} />
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

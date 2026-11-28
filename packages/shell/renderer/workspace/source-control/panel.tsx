// 오른쪽 sidebar의 Source Control 패널(spec 5.1). 대상 고르기(활성 탭 따라가기 + 고정), 브랜치 바, 커밋 칸, 충돌 배너,
// 바뀐 파일 묶음, Commits 섹션. 쓰기는 모두 core `source_control/*`(사람 자격)이 하고, 패널은 결과를 다시 읽는다.
import { t } from "@lophn/i18n";
import { Menu, MenuIcon, type MenuItem, Tooltip } from "@lophn/ui/overlay";
import { Button, Icon, IconButton } from "@lophn/ui/primitives";
import { iconPixels, systemClipboard } from "@lophn/ui/shared";
import { ChevronDown } from "lucide-react";
import {
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type {
  SourceControlFile,
  SourceControlOperation,
} from "../../../../protocol/projects/source-control.ts";
import type { CoreSource } from "../../desktop/connection/connection.ts";
import type { EventClient } from "../../desktop/connection/events/client.ts";
import { useMachineGrant } from "../../desktop/machines/context.tsx";
import { shellIcons, sourceControlIcons } from "../../icons/mod.ts";
import { PanelEmpty, PanelSection } from "../../shell/panel-rows.tsx";
import {
  PanelActions,
  PanelTitle,
  RightSidebar,
} from "../../shell/right-sidebar.tsx";
import { type DiffSpec, useWorktreeUi } from "../worktrees/context.tsx";
import {
  type CheckoutRef,
  checkoutKey,
  createSourceControlSource,
  type GitFailure,
  type GitResult,
  sameCheckout,
  targetOf,
} from "../worktrees/source.ts";
import {
  branchLabelOf,
  changedCountOf,
  type ProjectWorktrees,
} from "../worktrees/use-worktrees.ts";
import { BranchBar } from "./branch-bar.tsx";
import { type FileAction, Changes } from "./changes.tsx";
import { CommitBox } from "./commit-box.tsx";
import { ErrorCard, hintOf } from "./error-card.tsx";
import { History } from "./history.tsx";
import { baseName, groupFiles, type Section } from "./model.ts";
import { ConfirmDialog, DiscardDialog, NameDialog } from "./sc-dialogs.tsx";
import type { SectionKey, SourceControlStore } from "./store.ts";
import { useCheckoutStatus } from "./use-checkout-status.ts";
import styles from "./source-control.module.css";

/** workspace-window가 SidebarCtx로 내리는 것. */
export interface SourceControlPanelDeps {
  readonly store: SourceControlStore;
  /** "Show in Source Control"이 고정하라고 알린 체크아웃. nonce마다 한 번 받는다. */
  readonly focus: {
    readonly checkout: CheckoutRef;
    readonly nonce: number;
  } | null;
  /** 활성 탭의 체크아웃. 고정하지 않았으면 이것을 따라간다. */
  readonly active: CheckoutRef | null;
  readonly worktrees: ProjectWorktrees;
  readonly core: CoreSource;
  readonly events: EventClient | null;
  /** 다른 컴퓨터의 project. 읽기를 늦추고 허락이 없으면 읽기 전용이다. */
  readonly remote: boolean;
  openDiff(spec: DiffSpec, options: { readonly preview: boolean }): void;
  openFile(path: string, options: { readonly preview: boolean }): void;
  revealInExplorer?(path: string): void;
  /** OS 파일 관리자. 이 컴퓨터의 project만. */
  revealInOs?(path: string): void;
}

type Dialog =
  | {
      readonly kind: "discard";
      readonly files: readonly SourceControlFile[] | "all";
    }
  | {
      readonly kind: "branch-new";
      readonly name: string;
      readonly from: string | null;
      readonly error: string | null;
    }
  | {
      readonly kind: "branch-rename";
      readonly branch: string;
      readonly error: string | null;
    }
  | {
      readonly kind: "branch-delete";
      readonly branch: string;
      readonly error: string | null;
    };

const joinRel = (root: string, rel: string) =>
  `${root.replace(/\/+$/, "")}/${rel}`;

const opLabel = (op: SourceControlOperation) =>
  t(`source-control.label.op-${op}`);

function errorText(failure: GitFailure): string {
  return failure.message.split(/\r?\n/)[0] ?? failure.message;
}

function newRequestId(): string {
  return `scm-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
}

export function SourceControlPanel({
  project,
  folders,
  deps,
}: {
  project: string;
  folders: readonly string[];
  deps: SourceControlPanelDeps;
}) {
  const ui = useWorktreeUi();
  const { store, worktrees } = deps;
  const source = useMemo(
    () => createSourceControlSource(deps.core),
    [deps.core],
  );
  useSyncExternalStore(store.subscribe, store.version);
  const grant = useMachineGrant(deps.remote);

  // 고정을 알려 오면 받는다.
  const seenFocus = useRef<number | null>(null);
  useEffect(() => {
    if (deps.focus === null || seenFocus.current === deps.focus.nonce) return;
    seenFocus.current = deps.focus.nonce;
    store.setPinned(deps.focus.checkout);
  }, [deps.focus?.nonce]);

  // 고정한 worktree가 지워지면 그것이 난 폴더로 돌아간다. 지워진 뒤에는 목록에 없어 repo_root를 미리 기억해 둔다.
  const rootsOf = useRef(new Map<string, string>());
  for (const entry of worktrees.entries) {
    rootsOf.current.set(entry.record.id, entry.record.repo_root);
  }
  const pinned = store.pinned();
  useEffect(() => {
    if (pinned?.kind !== "worktree" || !worktrees.loaded) return;
    if (worktrees.byId(pinned.id) !== undefined) return;
    const root = rootsOf.current.get(pinned.id);
    const folder =
      folders.find(
        (one) =>
          root !== undefined && (one === root || one.startsWith(`${root}/`)),
      ) ?? folders[0];
    store.setPinned(
      folder === undefined ? null : { kind: "folder", path: folder },
    );
  }, [pinned, worktrees.loaded, worktrees.entries]);

  const known = (checkout: CheckoutRef | null): CheckoutRef | null => {
    if (checkout === null) return null;
    if (checkout.kind === "worktree") {
      return worktrees.byId(checkout.id) === undefined ? null : checkout;
    }
    return folders.includes(checkout.path) ? checkout : null;
  };
  const firstFolder: CheckoutRef | null =
    folders[0] === undefined ? null : { kind: "folder", path: folders[0] };
  const checkout = known(pinned) ?? known(deps.active) ?? firstFolder;
  const key = checkout === null ? "" : checkoutKey(checkout);
  const prefs = store.prefs(key);
  const entry =
    checkout?.kind === "worktree" ? worktrees.byId(checkout.id) : undefined;

  const target = checkout === null ? null : targetOf(project, checkout);
  const live = useCheckoutStatus({
    source,
    events: deps.events,
    project,
    checkout,
    remote: deps.remote,
  });
  const status = live.status;

  const [busy, setBusy] = useState<string | null>(null);
  const [opFailure, setOpFailure] = useState<GitFailure | null>(null);
  const [filter, setFilter] = useState("");
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [committing, setCommitting] = useState<number | null>(null);
  const [suggesting, setSuggesting] = useState<string | null>(null);
  // 대상을 바꾸면 앞 대상의 오류·필터를 지운다.
  useEffect(() => {
    setOpFailure(null);
    setFilter("");
  }, [key]);

  const readOnly =
    (deps.remote && grant === "denied") ||
    (status !== null && !status.can_write);

  const run = async <T,>(
    name: string,
    work: () => Promise<GitResult<T>>,
  ): Promise<GitResult<T>> => {
    setBusy(name);
    setOpFailure(null);
    const res = await work();
    setBusy(null);
    if (!res.ok) setOpFailure(res.error);
    live.reload();
    return res;
  };

  const groups = useMemo(
    () => groupFiles(status?.files ?? [], filter),
    [status?.files, filter],
  );
  // Discard All은 필터와 상관없이 모든 변경이다.
  const allChanges = useMemo(
    () => groupFiles(status?.files ?? [], "").changes,
    [status?.files],
  );
  const conflicts = (status?.files ?? []).filter(
    (file) => file.conflicted,
  ).length;
  const stagedCount = (status?.files ?? []).filter(
    (file) => file.staged && !file.conflicted,
  ).length;

  const setPrefs = (patch: Parameters<SourceControlStore["update"]>[1]) =>
    store.update(key, patch);
  const toggleSection = (section: SectionKey) => {
    const folded = new Set(prefs.folded);
    if (folded.has(section)) folded.delete(section);
    else folded.add(section);
    setPrefs({ folded });
  };

  // ---- 파일 조작 ----

  const root = status?.cwd ?? null;
  const fileAction = (
    action: FileAction,
    files: readonly SourceControlFile[],
    section: Section,
  ) => {
    if (target === null || checkout === null) return;
    const paths = files.map((file) => file.path);
    const first = files[0];
    switch (action) {
      case "stage":
        void run("stage", () => source.stage(target, { paths }));
        return;
      case "unstage":
        void run("unstage", () => source.unstage(target, { paths }));
        return;
      case "discard":
        setDialog({ kind: "discard", files });
        return;
      case "mark-resolved":
        void run("resolve", () => source.markResolved(target, { paths }));
        return;
      case "keep-file":
        void run("resolve", () =>
          source.markResolved(target, { paths, keep: "file" }),
        );
        return;
      case "keep-deletion":
        void run("resolve", () =>
          source.markResolved(target, { paths, keep: "deletion" }),
        );
        return;
      case "open-diff":
      case "open-diff-keep":
        if (first === undefined) return;
        deps.openDiff(
          {
            checkout,
            path: first.path,
            scope:
              section === "staged" ? { kind: "staged" } : { kind: "working" },
            status: first.untracked
              ? "U"
              : section === "staged"
                ? first.index_status
                : first.worktree_status,
          },
          { preview: action === "open-diff" },
        );
        return;
      case "open-file":
        if (first !== undefined && root !== null) {
          deps.openFile(joinRel(root, first.path), { preview: true });
        }
        return;
      case "copy-path":
        if (root !== null) {
          void systemClipboard.writeText(
            paths.map((p) => joinRel(root, p)).join("\n"),
          );
        }
        return;
      case "copy-relative-path":
        void systemClipboard.writeText(paths.join("\n"));
        return;
      case "reveal-explorer":
        if (first !== undefined && root !== null) {
          deps.revealInExplorer?.(joinRel(root, first.path));
        }
        return;
      case "reveal-os":
        if (first !== undefined && root !== null)
          deps.revealInOs?.(joinRel(root, first.path));
        return;
    }
  };

  const confirmDiscard = async (
    files: readonly SourceControlFile[] | "all",
  ) => {
    if (target === null) return;
    setDialog(null);
    await run("discard", () =>
      files === "all"
        ? source.discard(target, { all: true, include_untracked: true })
        : source.discard(target, { paths: files.map((file) => file.path) }),
    );
  };

  // ---- 커밋 ----

  const operation = status?.operation ?? null;
  const completing =
    operation !== null && operation !== "rebase" && conflicts === 0;
  const blocked = (() => {
    if (status === null) return t("source-control.label.working");
    if (readOnly) return t("source-control.notice.read-only");
    if (busy !== null) return t("source-control.note.commit-busy");
    if (conflicts > 0) return t("source-control.note.commit-conflicts");
    if (operation === "rebase") return t("source-control.note.commit-rebase");
    if (prefs.draft.trim() === "") return t("source-control.note.commit-empty");
    if (stagedCount === 0 && !completing)
      return t("source-control.note.commit-nothing-staged");
    return null;
  })();

  const sync = async (op: "fetch" | "pull" | "push" | "publish") => {
    if (target === null) return;
    if (op === "fetch") await run("fetch", () => source.fetch(target));
    else if (op === "pull") await run("pull", () => source.pull(target));
    else if (op === "push") await run("push", () => source.push(target, {}));
    else await run("push", () => source.push(target, { set_upstream: true }));
  };

  const commit = async (push: boolean) => {
    if (target === null || blocked !== null || status === null) return;
    const message = prefs.draft;
    setCommitting(Date.now());
    const res = await run("commit", () => source.commit(target, message));
    setCommitting(null);
    if (!res.ok) return;
    // 커밋하는 동안 사람이 새로 쓴 글은 지우지 않는다.
    if (store.prefs(key).draft === message) setPrefs({ draft: "" });
    if (push) await sync(status.upstream === null ? "publish" : "push");
  };

  const suggest = async () => {
    if (target === null) return;
    const request = newRequestId();
    setSuggesting(request);
    setOpFailure(null);
    const res = await source.suggestMessage(target, request);
    setSuggesting((current) => (current === request ? null : current));
    if (res.ok) setPrefs({ draft: res.value.message });
    else if (res.error.reason !== "cancelled") setOpFailure(res.error);
  };
  const stopSuggest = () => {
    if (suggesting === null) return;
    void source.cancelSuggest(suggesting);
    setSuggesting(null);
  };

  // ---- 충돌 ----

  const askAgent = () => {
    if (ui === null || operation === null || root === null) return;
    const files = (status?.files ?? [])
      .filter((file) => file.conflicted)
      .map((file) => `- ${file.path}`);
    const where =
      entry === undefined
        ? t("source-control.label.main-folder", { path: root })
        : t("source-control.label.worktree-where", {
            name: entry.record.label,
            path: entry.record.path,
          });
    ui.openAgent(entry?.record.id ?? null, {
      prompt: t("source-control.label.agent-resolve-prompt", {
        operation: opLabel(operation).toLowerCase(),
        where,
        files: files.join("\n"),
      }),
    });
  };

  // ---- 브랜치 ----

  const branchFailure = (failure: GitFailure) =>
    hintOf(failure) ?? errorText(failure);

  const submitBranch = async (
    d: Extract<Dialog, { kind: "branch-new" }>,
    name: string,
  ) => {
    if (target === null) return;
    const res = await run("branch", () =>
      source.branchCreate(target, {
        name,
        checkout: true,
        ...(d.from === null ? {} : { start_point: d.from }),
      }),
    );
    if (res.ok) setDialog(null);
    else {
      // 실패는 창 안에서 말한다. 패널의 오류 카드에 같은 것을 또 띄우지 않는다.
      setOpFailure(null);
      setDialog({ ...d, name, error: branchFailure(res.error) });
    }
  };

  const checkouts = [
    ...folders.map((path) => ({
      path,
      ref: { kind: "folder" as const, path },
    })),
    ...worktrees.entries.map((one) => ({
      path: one.record.path,
      ref: { kind: "worktree" as const, id: one.record.id },
    })),
  ];

  // ---- 대상 고르기 ----

  const pickItems: MenuItem[] = [
    {
      id: "follow",
      label: t("source-control.label.target-follow"),
      leading:
        pinned === null ? (
          <MenuIcon icon={sourceControlIcons.resolved} />
        ) : undefined,
    },
    ...folders.flatMap((folder, at): MenuItem[] => {
      const children = worktrees.entries.filter(
        (one) =>
          one.record.repo_root === folder ||
          folder.startsWith(`${one.record.repo_root}/`) ||
          // 등록 폴더 어디에도 맞지 않는 worktree는 첫 폴더 아래에 둔다.
          (at === 0 &&
            !folders.some(
              (other) =>
                one.record.repo_root === other ||
                other.startsWith(`${one.record.repo_root}/`),
            )),
      );
      const folderRef: CheckoutRef = { kind: "folder", path: folder };
      return [
        {
          id: `dir:${folder}`,
          textValue: baseName(folder),
          separatorBefore: at === 0,
          leading: <MenuIcon icon={shellIcons.folder} />,
          label: (
            <span className={styles.pickRow} data-sc-target={folder}>
              <span className={styles.pickName}>{baseName(folder)}</span>
              {sameCheckout(checkout, folderRef) ? (
                <Icon
                  icon={sourceControlIcons.resolved}
                  pixels={iconPixels("small")}
                />
              ) : null}
            </span>
          ),
        },
        ...children.map((one): MenuItem => {
          const count = changedCountOf(one.status);
          const ref: CheckoutRef = { kind: "worktree", id: one.record.id };
          return {
            id: `wkt:${one.record.id}`,
            textValue: branchLabelOf(one),
            leading: <MenuIcon icon={sourceControlIcons.branch} />,
            disabled: one.record.status !== "ready",
            label: (
              <span
                className={styles.pickRow}
                data-sc-target={one.record.id}
                data-indent=""
              >
                <span className={styles.pickName}>{branchLabelOf(one)}</span>
                {count > 0 ? (
                  <span className={styles.countBadge}>{count}</span>
                ) : null}
                {sameCheckout(checkout, ref) ? (
                  <Icon
                    icon={sourceControlIcons.resolved}
                    pixels={iconPixels("small")}
                  />
                ) : null}
              </span>
            ),
          };
        }),
      ];
    }),
  ];

  const titleName =
    checkout === null
      ? t("source-control.label.sidebar-tab")
      : entry !== undefined
        ? branchLabelOf(entry)
        : baseName(checkout.kind === "folder" ? checkout.path : "");

  const head = (
    <>
      <PanelTitle>
        <Menu
          trigger={
            <button
              type="button"
              className={styles.pickHead}
              aria-label={t("source-control.label.target-picker")}
              data-sc-picker=""
            >
              <Icon icon={ChevronDown} pixels={iconPixels("small")} />
              <span className={styles.pickTitle}>{titleName}</span>
              {pinned === null ? null : (
                <span className={styles.pinnedMark}>
                  {t("source-control.label.target-pinned")}
                </span>
              )}
            </button>
          }
          items={pickItems}
          onSelect={(id) => {
            if (id === "follow") store.setPinned(null);
            else if (id.startsWith("dir:"))
              store.setPinned({ kind: "folder", path: id.slice(4) });
            else if (id.startsWith("wkt:"))
              store.setPinned({ kind: "worktree", id: id.slice(4) });
          }}
        />
      </PanelTitle>
      <PanelActions>
        <div
          role="toolbar"
          aria-label={t("source-control.label.actions")}
          style={{ display: "flex" }}
        >
          <Tooltip content={t("source-control.button.refresh")}>
            <IconButton
              size="sm"
              icon={sourceControlIcons.refresh}
              label={t("source-control.button.refresh")}
              data-sc-head="refresh"
              onClick={() => live.reload()}
            />
          </Tooltip>
          <Tooltip
            content={
              prefs.view === "flat"
                ? t("source-control.button.view-tree")
                : t("source-control.button.view-list")
            }
          >
            <IconButton
              size="sm"
              icon={
                prefs.view === "flat"
                  ? sourceControlIcons.tree
                  : sourceControlIcons.list
              }
              label={
                prefs.view === "flat"
                  ? t("source-control.button.view-tree")
                  : t("source-control.button.view-list")
              }
              data-sc-head="view"
              onClick={() =>
                setPrefs({ view: prefs.view === "flat" ? "tree" : "flat" })
              }
            />
          </Tooltip>
          <Menu
            trigger={
              <IconButton
                size="sm"
                icon={shellIcons.more}
                label={t("source-control.label.actions")}
                data-sc-head="more"
              />
            }
            items={[
              {
                id: "fetch",
                label: t("source-control.button.fetch"),
                disabled: readOnly || status?.has_remote !== true,
              },
              {
                id: "stage-all",
                label: t("source-control.button.stage-all"),
                separatorBefore: true,
                disabled: readOnly || allChanges.length === 0,
              },
              {
                id: "unstage-all",
                label: t("source-control.button.unstage-all"),
                disabled: readOnly || stagedCount === 0,
              },
              {
                id: "discard-all",
                label: t("source-control.button.discard-all"),
                disabled: readOnly || allChanges.length === 0,
              },
              {
                id: "collapse-all",
                label: t("source-control.button.collapse-all"),
                separatorBefore: true,
              },
            ]}
            onSelect={(id) => {
              if (target === null) return;
              if (id === "fetch") void sync("fetch");
              else if (id === "stage-all")
                void run("stage", () => source.stage(target, { all: true }));
              else if (id === "unstage-all")
                void run("unstage", () =>
                  source.unstage(target, { all: true }),
                );
              else if (id === "discard-all")
                setDialog({ kind: "discard", files: "all" });
              else if (id === "collapse-all") {
                setPrefs({
                  folded: new Set<SectionKey>([
                    "conflicts",
                    "staged",
                    "changes",
                    "commits",
                  ]),
                });
              }
            }}
          />
        </div>
      </PanelActions>
    </>
  );

  const frame = (body: ReactNode) => (
    <RightSidebar title={null} panel="source-control">
      {head}
      <section className={styles.panel} data-source-control="">
        {body}
      </section>
    </RightSidebar>
  );

  if (checkout === null || target === null) {
    return frame(
      <PanelEmpty>{t("source-control.empty.no-folder")}</PanelEmpty>,
    );
  }
  if (entry !== undefined && entry.status.presence !== "present") {
    return frame(
      <div className={styles.banner} data-tone="warning" role="alert">
        <span>
          {entry.status.presence === "unmounted"
            ? t("source-control.notice.unmounted")
            : t("source-control.notice.missing")}
        </span>
        {entry.status.presence === "missing" && ui !== null && !readOnly ? (
          <Button size="sm" onClick={() => ui.openRemove(entry.record.id)}>
            {t("source-control.button.remove-record")}
          </Button>
        ) : null}
      </div>,
    );
  }
  if (status === null) {
    if (live.failure?.reason === "not_git_repository") {
      return frame(
        <PanelEmpty>{t("source-control.empty.not-git")}</PanelEmpty>,
      );
    }
    return frame(
      live.failure === null ? null : (
        <>
          <ErrorCard failure={live.failure} />
          <Button size="sm" onClick={() => live.reload()}>
            {t("source-control.button.retry")}
          </Button>
        </>
      ),
    );
  }

  const files = status.files;
  const filtering = filter.trim() !== "";
  const sectionActions = (section: Section) => {
    if (readOnly || filtering) return undefined;
    if (section === "staged") {
      return (
        <IconButton
          size="sm"
          icon={sourceControlIcons.unstage}
          label={t("source-control.button.unstage-all")}
          data-sc-bulk="unstage-all"
          onClick={() =>
            void run("unstage", () => source.unstage(target, { all: true }))
          }
        />
      );
    }
    if (section === "changes") {
      return (
        <span style={{ display: "flex" }}>
          <IconButton
            size="sm"
            icon={sourceControlIcons.discard}
            label={t("source-control.button.discard-all")}
            data-sc-bulk="discard-all"
            onClick={() => setDialog({ kind: "discard", files: "all" })}
          />
          <IconButton
            size="sm"
            icon={sourceControlIcons.stage}
            label={t("source-control.button.stage-all")}
            data-sc-bulk="stage-all"
            onClick={() =>
              void run("stage", () => source.stage(target, { all: true }))
            }
          />
        </span>
      );
    }
    return undefined;
  };
  const changeSection = (
    section: Section,
    title: string,
    list: readonly SourceControlFile[],
  ) =>
    list.length === 0 &&
    !(section === "changes" && (files.length === 0 || filtering)) ? null : (
      <PanelSection
        key={section}
        title={title}
        count={list.length}
        folded={prefs.folded.has(section)}
        onToggle={
          section === "conflicts" ? undefined : () => toggleSection(section)
        }
        actions={sectionActions(section)}
        data-section={`sc-${section}`}
      >
        {prefs.folded.has(section) &&
        section !== "conflicts" ? null : list.length === 0 ? (
          <PanelEmpty>
            {filtering
              ? t("source-control.empty.no-match")
              : t("source-control.empty.clean")}
          </PanelEmpty>
        ) : (
          <Changes
            section={section}
            files={list}
            view={prefs.view}
            readOnly={readOnly}
            closedDirs={prefs.closedDirs}
            canRevealOs={deps.revealInOs !== undefined}
            onToggleDir={(dir) => {
              const closed = new Set(prefs.closedDirs);
              if (closed.has(dir)) closed.delete(dir);
              else closed.add(dir);
              setPrefs({ closedDirs: closed });
            }}
            onAction={fileAction}
          />
        )}
      </PanelSection>
    );

  return frame(
    <>
      {readOnly && deps.remote ? (
        <div className={styles.banner} data-tone="info" role="status">
          {t("source-control.notice.read-only")}
        </div>
      ) : null}
      {operation !== null || conflicts > 0 ? (
        <div
          className={styles.banner}
          data-tone="danger"
          role="alert"
          data-sc-conflict-banner=""
        >
          <span>
            {t("source-control.notice.conflict-banner", {
              operation:
                operation === null ? opLabel("merge") : opLabel(operation),
              count: conflicts,
            })}
          </span>
          <span className={styles.bannerActions}>
            {completing ? (
              <Button
                size="sm"
                variant="primary"
                disabled={blocked !== null}
                onClick={() => void commit(false)}
              >
                {t("source-control.button.complete", {
                  operation: opLabel(operation),
                })}
              </Button>
            ) : null}
            {operation !== null && !readOnly ? (
              <Button
                size="sm"
                disabled={busy !== null}
                data-sc-abort=""
                onClick={() => void run("abort", () => source.abort(target))}
              >
                {t("source-control.button.abort", {
                  operation: opLabel(operation),
                })}
              </Button>
            ) : null}
            {conflicts > 0 && ui !== null && operation !== null ? (
              <Button size="sm" data-sc-ask-agent="" onClick={askAgent}>
                {t("source-control.button.ask-agent")}
              </Button>
            ) : null}
          </span>
        </div>
      ) : null}
      <BranchBar
        status={status}
        source={source}
        target={target}
        readOnly={readOnly}
        busy={busy !== null}
        checkouts={checkouts.filter((one) => !sameCheckout(one.ref, checkout))}
        onJump={(ref) => store.setPinned(ref)}
        onSwitch={(branch) =>
          void run("switch", () => source.switchBranch(target, branch))
        }
        onCreate={(name) =>
          setDialog({
            kind: "branch-new",
            name: name ?? "",
            from: null,
            error: null,
          })
        }
        onRename={(branch) =>
          setDialog({ kind: "branch-rename", branch, error: null })
        }
        onDelete={(branch) =>
          setDialog({ kind: "branch-delete", branch, error: null })
        }
        onSync={(op) => void sync(op)}
      />
      {readOnly ? null : (
        <CommitBox
          draft={prefs.draft}
          onDraft={(text) => setPrefs({ draft: text })}
          blocked={blocked}
          commitLabel={
            completing
              ? t("source-control.button.complete", {
                  operation: opLabel(operation),
                })
              : t("source-control.button.commit")
          }
          canPush={status.has_remote && !status.detached}
          committing={
            committing === null
              ? null
              : { since: committing, hooks: status.hooks }
          }
          suggest={{
            available: status.suggest.available && stagedCount > 0,
            reason: !status.suggest.available
              ? (status.suggest.reason ?? t("source-control.hint.no_model"))
              : stagedCount === 0
                ? t("source-control.note.ai-no-staged")
                : null,
            running: suggesting !== null,
          }}
          onCommit={(push) => void commit(push)}
          onSuggest={() => void suggest()}
          onStopSuggest={stopSuggest}
        />
      )}
      {opFailure === null ? null : (
        <ErrorCard failure={opFailure} onDismiss={() => setOpFailure(null)} />
      )}
      {status.truncated ? (
        <div className={styles.banner} data-tone="warning" role="status">
          <span>
            {t("source-control.notice.truncated", { count: files.length })}
          </span>
          <Button size="sm" onClick={() => live.reload()}>
            {t("source-control.button.retry")}
          </Button>
        </div>
      ) : null}
      {files.length === 0 ? null : (
        <input
          className={styles.filterInput}
          value={filter}
          placeholder={t("source-control.label.filter")}
          aria-label={t("source-control.label.filter")}
          data-sc-filter=""
          onChange={(event) => setFilter(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setFilter("");
              event.currentTarget.blur();
            }
          }}
        />
      )}
      {changeSection(
        "conflicts",
        t("source-control.heading.conflicts"),
        groups.conflicts,
      )}
      {changeSection(
        "staged",
        t("source-control.heading.staged"),
        groups.staged,
      )}
      {changeSection(
        "changes",
        t("source-control.heading.changes"),
        groups.changes,
      )}
      <PanelSection
        title={t("source-control.heading.commits")}
        folded={prefs.folded.has("commits")}
        onToggle={() => toggleSection("commits")}
        data-section="sc-commits"
      >
        {prefs.folded.has("commits") ? null : status.unborn ? (
          <PanelEmpty>{t("source-control.empty.no-commits")}</PanelEmpty>
        ) : (
          <History
            source={source}
            target={target}
            head={status.head_sha}
            ahead={status.ahead}
            hasUpstream={status.upstream !== null}
            readOnly={readOnly}
            onOpenFile={(sha, path, fileStatus, keep) =>
              deps.openDiff(
                {
                  checkout,
                  path,
                  scope: { kind: "commit", sha },
                  status: fileStatus.slice(0, 1),
                },
                { preview: !keep },
              )
            }
            onBranchFrom={(sha) =>
              setDialog({
                kind: "branch-new",
                name: "",
                from: sha,
                error: null,
              })
            }
          />
        )}
      </PanelSection>
      {dialog?.kind === "discard" ? (
        <DiscardDialog
          name={
            dialog.files !== "all" && dialog.files.length === 1
              ? baseName(dialog.files[0]!.path)
              : null
          }
          tracked={
            (dialog.files === "all" ? allChanges : dialog.files).filter(
              (file) => !file.untracked,
            ).length
          }
          untracked={
            (dialog.files === "all" ? allChanges : dialog.files).filter(
              (file) => file.untracked,
            ).length
          }
          onConfirm={() => void confirmDiscard(dialog.files)}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog?.kind === "branch-new" ? (
        <NameDialog
          title={
            dialog.from === null
              ? t("source-control.title.new-branch")
              : t("source-control.title.branch-from", {
                  ref: dialog.from.slice(0, 7),
                })
          }
          note={t("source-control.notice.new-branch")}
          initial={dialog.name}
          confirm={t("source-control.button.create")}
          error={dialog.error}
          onSubmit={(name) => void submitBranch(dialog, name)}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog?.kind === "branch-rename" ? (
        <NameDialog
          title={t("source-control.title.rename-branch", {
            name: dialog.branch,
          })}
          initial={dialog.branch}
          confirm={t("source-control.button.rename")}
          error={dialog.error}
          onSubmit={(name) =>
            void run("branch", () =>
              source.branchRename(target, dialog.branch, name),
            ).then((res) =>
              res.ok
                ? setDialog(null)
                : setDialog({ ...dialog, error: branchFailure(res.error) }),
            )
          }
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog?.kind === "branch-delete" ? (
        <ConfirmDialog
          title={t("source-control.title.delete-branch", {
            name: dialog.branch,
          })}
          text={t("source-control.notice.delete-branch")}
          confirm={t("source-control.button.delete")}
          error={dialog.error}
          onConfirm={() =>
            void run("branch", () =>
              source.branchDelete(target, dialog.branch),
            ).then((res) =>
              res.ok
                ? setDialog(null)
                : setDialog({
                    ...dialog,
                    error:
                      res.error.reason === "unmerged"
                        ? t("source-control.hint.unmerged")
                        : branchFailure(res.error),
                  }),
            )
          }
          onClose={() => setDialog(null)}
        />
      ) : null}
    </>,
  );
}

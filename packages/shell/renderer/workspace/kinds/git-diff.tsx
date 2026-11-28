// git_diff 탭 kind. 한 체크아웃의 파일 하나를 working tree·staged·커밋 하나 범위로 비교한다.
// preview 규칙은 document_editor와 같다(한 번 클릭 preview, 두 번·Enter 고정). layout 파일에 저장하지 않는다:
// diff는 지금 git 상태에서 다시 열면 되고, 저장하면 지워진 worktree를 가리키는 탭이 되살아난다.
import { t } from "@lophn/i18n";
import { FileIcon } from "@lophn/ui/primitives";
import { useMachineGrant } from "../../desktop/machines/context.tsx";
import { sourceControlIcons } from "../../icons/mod.ts";
import { showAfter } from "../open-policy.ts";
import type { TabItem } from "../model.ts";
import { DiffView } from "../source-control/diff-view.tsx";
import { baseName } from "../source-control/model.ts";
import { type DiffSpec, useWorktreeUi } from "../worktrees/context.tsx";
import { type CheckoutRef, checkoutKey } from "../worktrees/source.ts";
import { openFile } from "./document-editor.tsx";
import type { TabHost } from "./host.ts";
import type { TabKindDef } from "./kind.ts";

const KIND = "git_diff";

function scopeKeyOf(spec: DiffSpec): string {
  return spec.scope.kind === "commit"
    ? `commit:${spec.scope.sha}`
    : spec.scope.kind;
}

export function gitDiffKey(spec: DiffSpec): string {
  return `git-diff:${checkoutKey(spec.checkout)}:${scopeKeyOf(spec)}:${spec.path}`;
}

/** 탭 fields에서 diff 대상을 읽는다. 맞지 않으면 null. */
export function diffSpecOf(tab: TabItem): DiffSpec | null {
  const f = tab.fields ?? {};
  const path = f.path;
  if (typeof path !== "string") return null;
  let checkout: CheckoutRef;
  if (f.checkout === "worktree" && typeof f.worktree === "string") {
    checkout = { kind: "worktree", id: f.worktree };
  } else if (f.checkout === "folder" && typeof f.folder === "string") {
    checkout = { kind: "folder", path: f.folder };
  } else return null;
  const scope: DiffSpec["scope"] =
    f.scope === "staged"
      ? { kind: "staged" }
      : f.scope === "commit" && typeof f.sha === "string"
        ? { kind: "commit", sha: f.sha }
        : { kind: "working" };
  return {
    checkout,
    path,
    scope,
    ...(typeof f.status === "string" ? { status: f.status } : {}),
  };
}

function scopeLabel(spec: DiffSpec): string {
  return spec.scope.kind === "commit"
    ? spec.scope.sha.slice(0, 7)
    : spec.scope.kind === "staged"
      ? t("source-control.label.scope-staged")
      : t("source-control.label.scope-working");
}

/**
 * diff 탭을 연다. 이미 열려 있으면 그 자리에서 보인다. preview면 그 desk의 preview 자리를 바꿔 쓴다.
 * `root`(체크아웃 절대 경로)를 주면 탭 menu의 Copy Path와 Open File이 그 파일을 가리킨다.
 */
export function openGitDiff(
  host: TabHost,
  spec: DiffSpec,
  options: {
    readonly preview?: boolean;
    readonly root?: string | null;
    readonly from?: string;
  } = {},
): void {
  host.openTab(
    {
      key: gitDiffKey(spec),
      kind: KIND,
      title: baseName(spec.path),
      fields: {
        path: spec.path,
        checkout: spec.checkout.kind,
        ...(spec.checkout.kind === "worktree"
          ? { worktree: spec.checkout.id }
          : { folder: spec.checkout.path }),
        scope: spec.scope.kind,
        ...(spec.scope.kind === "commit" ? { sha: spec.scope.sha } : {}),
        ...(spec.status === undefined ? {} : { status: spec.status }),
        ...(options.root == null ? {} : { root: options.root }),
      },
      ...(options.preview === true ? { preview: true } : {}),
    },
    showAfter(host.desk, options.from),
  );
}

function rootOf(tab: TabItem): string | null {
  const root = tab.fields?.root;
  return typeof root === "string" ? root : null;
}

function GitDiffTab({
  tab,
  active,
  host,
}: {
  tab: TabItem;
  active: boolean;
  host: TabHost;
}) {
  const ui = useWorktreeUi();
  const machine = tab.machine ?? host.machine;
  const remote = machine !== null;
  const grant = useMachineGrant(remote);
  const spec = diffSpecOf(tab);
  if (spec === null || host.projectId === null) return null;
  const root =
    rootOf(tab) ??
    (spec.checkout.kind === "folder"
      ? spec.checkout.path
      : (ui?.worktrees.byId(spec.checkout.id)?.record.path ?? null));
  return (
    <DiffView
      key={tab.key}
      project={host.projectId}
      spec={spec}
      core={host.machineData(machine).core}
      localCore={host.machineData(null).core}
      readOnly={remote && grant === "denied"}
      root={root}
      active={active}
      onOpenFile={(path) => openFile(host, path, { from: tab.key })}
    />
  );
}

export const gitDiffKind: TabKindDef = {
  kind: KIND,
  labelKey: "source-control.label.kind-git-diff",
  icon: sourceControlIcons.branch,
  titleOf: (tab) => {
    const spec = diffSpecOf(tab);
    return spec === null
      ? undefined
      : t("source-control.label.diff-title", {
          name: baseName(spec.path),
          scope: scopeLabel(spec),
        });
  },
  iconOf: (tab) => <FileIcon name={tab.title} size={14} />,
  pathOf: (tab) => {
    const root = rootOf(tab);
    const spec = diffSpecOf(tab);
    return root === null || spec === null ? null : `${root}/${spec.path}`;
  },
  render: (tab, active, host) => (
    <GitDiffTab tab={tab} active={active} host={host} />
  ),
};

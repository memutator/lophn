// artifact 화면 일곱 장. 탭 줄, 모은 목록 panel, 대화 글은 renderer의 실제 component이고 artifact 탭 틀, sidebar 목록, link는
// 아직 renderer에 없는 새 모양이다. 화면 task가 이 모양을 renderer로 옮긴다(page id는 바꾸지 않는다).
import { EmptyState } from "@lophn/ui/feedback";
import { Icon, IconButton } from "@lophn/ui/primitives";
import { Toast, Tooltip } from "@lophn/ui/overlay";
import { iconPixels } from "@lophn/ui/shared";
import { t } from "@lophn/wording";

import { AnnotationPanel } from "../../../../packages/shell/renderer/app-frame/annotate/annotation-panel.tsx";
import { STAY } from "../../../../packages/shell/renderer/app-frame/annotate/use-view-toast.ts";
import {
  AgentTurn,
  Said,
  UserMessage,
} from "../../../../packages/shell/renderer/conversation/message-list/agent-turn.tsx";
import { TabStrip } from "../../../../packages/shell/renderer/parts/tab-strip/tab-strip.tsx";
import { workspaceIcons } from "../../../../packages/shell/renderer/icons/mod.ts";
import { ANNOTATIONS, ARTIFACTS, FILE_TAB, SPENDING, WRITER } from "./data.ts";
import { artifactIcons } from "./icons.ts";
import { SpendingView } from "./spending-view.tsx";
import { ArtifactTab } from "./tab-frame.tsx";
import styles from "./artifact.module.css";

const noop = () => {};

export function ArtifactTabPage() {
  return (
    <ArtifactTab title={SPENDING.title} name={SPENDING.name}>
      <SpendingView title={SPENDING.title} />
    </ArtifactTab>
  );
}

export function ArtifactTabFilePage() {
  return (
    <ArtifactTab
      title={FILE_TAB.title}
      name={FILE_TAB.file}
      rootNote={t("artifact.note.file-root", { folder: FILE_TAB.folder })}
    >
      <SpendingView title={FILE_TAB.title} />
    </ArtifactTab>
  );
}

export function ArtifactAnnotatePage() {
  return (
    <ArtifactTab
      title={SPENDING.title}
      name={SPENDING.name}
      annotateOn
      overlay={
        <>
          <div className={styles.toasts}>
            <Toast
              title={t("artifact.title.annotate-on")}
              body={t("artifact.text.annotate-on")}
              timer={STAY}
              onClose={noop}
            />
            <Toast
              title={t("artifact.title.annotations-sent", {
                count: ANNOTATIONS.length,
                agent: WRITER,
              })}
              body={t("artifact.text.annotations-sent")}
              timer={STAY}
              onClose={noop}
            />
          </div>
          <AnnotationPanel
            items={ANNOTATIONS.map((item) => ({ ...item }))}
            sending={false}
            failure={null}
            onRemove={noop}
            onClear={noop}
            onSend={noop}
          />
        </>
      }
    >
      <SpendingView
        title={SPENDING.title}
        picked={{
          Dining: { n: 1, memo: ANNOTATIONS[0].note },
          Rent: { n: 2 },
        }}
      />
    </ArtifactTab>
  );
}

export function ArtifactMissingPage() {
  return (
    <ArtifactTab title={SPENDING.name} name={SPENDING.name} missing>
      <EmptyState
        icon={artifactIcons.missing}
        message={t("artifact.empty.missing", { name: SPENDING.name })}
        action={{ label: t("common.button.retry"), onSelect: noop }}
      />
    </ArtifactTab>
  );
}

const SIDEBAR_TABS = ["explorer", "agent", "artifact"] as const;

function SidebarRows(
  { rows }: { rows: readonly (typeof ARTIFACTS)[number][] },
) {
  if (rows.length === 0) {
    return <p className={styles.sideEmpty}>{t("artifact.empty.none")}</p>;
  }
  return (
    <ul className={styles.rows} aria-label={t("artifact.label.list")}>
      {rows.map((row) => (
        <li
          key={row.name}
          className={styles.row}
          data-selected={row.name === SPENDING.name ? "" : undefined}
        >
          <span className={styles.rowIcon}>
            <Icon icon={artifactIcons.kind} pixels={iconPixels("base")} />
          </span>
          <span className={styles.rowText}>
            <span className={styles.rowHead}>
              <span className={styles.rowTitle}>{row.title}</span>
              <span className={styles.rowName}>{row.name}</span>
            </span>
            <span className={styles.rowDesc}>{row.description}</span>
          </span>
          <span className={styles.rowAction}>
            <IconButton
              icon={workspaceIcons.trash}
              label={t("artifact.button.delete")}
              size="sm"
              onClick={noop}
            />
          </span>
        </li>
      ))}
    </ul>
  );
}

function ArtifactSidebar(
  { rows }: { rows: readonly (typeof ARTIFACTS)[number][] },
) {
  return (
    <nav className={styles.sidebar}>
      <TabStrip
        compact
        tabs={SIDEBAR_TABS.map((key) => ({
          key,
          title: t(`project-workspace.label.sidebar-tab-${key}`),
        }))}
        selected="artifact"
      />
      <div className={styles.sidebarBody}>
        <SidebarRows rows={rows} />
      </div>
    </nav>
  );
}

/** project sidebar의 Artifacts 탭. artifact가 있을 때의 목록이다. */
export function ArtifactSidebarListPage() {
  return (
    <div className={styles.sideLayout}>
      <ArtifactSidebar rows={ARTIFACTS} />
    </div>
  );
}

/** artifact가 하나도 없을 때의 Artifacts 탭이다. */
export function ArtifactSidebarEmptyPage() {
  return (
    <div className={styles.sideLayout}>
      <ArtifactSidebar rows={[]} />
    </div>
  );
}

function ArtifactLink(
  { path, hover = false }: { path: string; hover?: boolean },
) {
  const link = (
    <button
      type="button"
      className={styles.link}
      data-hover={hover ? "" : undefined}
      onClick={noop}
    >
      <Icon icon={artifactIcons.kind} pixels={iconPixels("small")} />
      {path}
    </button>
  );
  if (!hover) return link;
  return (
    <Tooltip
      open
      content={
        <span className={styles.hoverCard}>
          <span className={styles.hoverTitle}>{SPENDING.title}</span>
          <span>{SPENDING.description}</span>
          <span className={styles.hoverAction}>
            {t("artifact.label.open-link")}
          </span>
        </span>
      }
    >
      {link}
    </Tooltip>
  );
}

const AGENT = {
  name: WRITER,
  profile: { kind: "initial", text: "O" },
} as const;

/** agent의 말 안 artifact path가 link가 된 모양. 위는 평소 모양과 link가 아닌 path, 아래는 hover해 설명이 뜬 모양이다. */
export function ArtifactChatLinkPage() {
  return (
    <div className={styles.chat}>
      <div className={styles.thread}>
        <UserMessage>When are the tax dates?</UserMessage>
        <AgentTurn agent={AGENT} time="10:42">
          <Said>
            <p className={styles.said}>
              Written to{" "}
              <ArtifactLink path="artifacts/tax-deadlines/index.html" />. The
              older draft in{" "}
              <span className={styles.plainPath}>
                artifacts/old-draft/index.html
              </span>{" "}
              is gone, so it stays plain text.
            </p>
          </Said>
        </AgentTurn>
        <UserMessage>Show this month's spending as a chart.</UserMessage>
        <AgentTurn agent={AGENT} time="10:44">
          <Said>
            <p className={styles.said}>
              Done. I wrote the chart to{" "}
              <ArtifactLink path="artifacts/spending/index.html" hover />{" "}
              and put the figures in its data folder.
            </p>
          </Said>
        </AgentTurn>
      </div>
    </div>
  );
}

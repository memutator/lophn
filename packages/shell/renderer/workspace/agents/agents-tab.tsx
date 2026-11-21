// workspace(Home, project, 앱)의 Agents 탭 본문. 위에서부터 전역 agent와 이 workspace 범위 agent의 카드 목록(lophn이 첫 줄)과 [New agent],
// 카드 앞면은 정의를 네 묶음으로 한눈에 보인다(머리가 누구, 그 아래 Runs on · Sees · Works how 세 줄, menu의 Duplicate).
// 사람의 coding agent(내장 coding agent) 카드, 같이 쓰는 지침(LOPHN.md, 앱은 AGENTS.md), workspace memory, workspace 층 model 하나, skill,
// MCP server와 맨 아래 "Agent definitions are stored in lophn, not in your project folder." 한 줄이다. [Open]이 여는 editor는 editor/agent-editor.tsx가 맡는다.

import { Card } from "@lophn/ui/layout";
import { Menu, MenuIcon } from "@lophn/ui/overlay";
import { Button, IconButton } from "@lophn/ui/primitives";
import { t } from "@lophn/i18n";
import type { ReactElement, ReactNode } from "react";
import type { ModelChoice } from "../../../../protocol/lophn-agent/models.ts";
import { MEMORY_MAX_BYTES } from "../../../../protocol/lophn-agent/tool-lists.ts";
import {
  isCodingBuiltin,
  isLophn,
} from "../../../../protocol/lophn-agent/workspaces.ts";
import { actionIcons, shellIcons } from "../../icons/mod.ts";
import { Avatar, type AvatarProfile } from "../../parts/avatar/avatar.tsx";
import { scopeLabel } from "./agent-card.tsx";
import { CardGlance } from "./agent-glance.tsx";
import { kindOfWorkspace } from "./agent-key.ts";
import { codingFaceOf } from "./coding-face.ts";
import styles from "./agents-tab.module.css";
import {
  InstructionsEditor,
  type InstructionsPort,
} from "./editor/instructions-editor.tsx";
import { ModelField, type ModelFieldSource } from "./editor/model-field.tsx";
import { McpList, SkillList } from "./editor/parts.tsx";
import type { AgentListRow, AgentsOverview, ModelsView } from "./source.ts";
import type { ImageSrc } from "./views.ts";

interface AgentsTabProps {
  /** 이 탭의 workspace 열쇠: "home", project id, 앱 id. */
  readonly workspace: string;
  /** workspace(Home, project, 앱)의 이름. */
  readonly workspaceName: string;
  readonly overview: AgentsOverview;
  readonly models: ModelsView | null;
  /** Model 칸이 목록을 다시 읽는 통로. */
  readonly source: ModelFieldSource;
  readonly imageSrc: ImageSrc;
  /** 카드의 [Open]. 같은 탭 안에서 그 agent의 editor를 연다. */
  readonly onOpenAgent: (assignment: string) => void;
  /** [New agent]. */
  readonly onNewAgent: () => void;
  /** 카드 menu의 [Duplicate]. 그 agent를 본뜬 새 agent를 같은 탭에서 연다. */
  readonly onDuplicateAgent: (assignment: string) => void;
  /** Instructions의 지침 파일을 이 자리에서 고치는 길. */
  readonly instructions: InstructionsPort;
  /** workspace memory를 이 자리에서 고치는 길. */
  readonly memory: InstructionsPort;
  readonly onWorkspaceModel: (choice: ModelChoice | null) => void;
  readonly onToggleSkill: (name: string, on: boolean) => void;
  readonly onAddSkill: () => void;
  readonly onToggleMcp: (name: string, on: boolean) => void;
  readonly onAddServer: () => void;
}

/** 미리보기로 보이는 지침·memory 줄 수. */
const PREVIEW_LINES = 3;

function avatarProfile(row: AgentListRow, imageSrc: ImageSrc): AvatarProfile {
  return (
    codingFaceOf(row.assignment) ??
    (row.profile.kind === "character"
      ? row.profile
      : { kind: "image", src: imageSrc(row.assignment, row.profile.image) })
  );
}

function AgentCardView({
  row,
  workspaceName: tabWorkspaceName,
  models,
  imageSrc,
  onOpen,
  onDuplicate,
}: {
  row: AgentListRow;
  workspaceName: string;
  models: ModelsView | null;
  imageSrc: ImageSrc;
  onOpen: () => void;
  onDuplicate: () => void;
}): ReactElement {
  // Home 목록에는 다른 workspace의 범위 agent가 섞여 있어 줄이 자기 범위의 이름을 가진다.
  const workspaceName = row.workspaceName ?? tabWorkspaceName;
  const lophn = isLophn(row.assignment);
  return (
    <li
      className={styles.card}
      data-agent-card=""
      data-assignment={row.assignment}
    >
      <Card>
        <div className={styles.cardBody}>
          <div className={styles.cardHead}>
            <Avatar profile={avatarProfile(row, imageSrc)} size="md" />
            <div className={styles.who}>
              <h3 className={styles.name} data-agent-name="">
                {row.name}
              </h3>
              <p
                className={
                  row.description === undefined && !lophn
                    ? `${styles.role} ${styles.roleEmpty}`
                    : styles.role
                }
                data-agent-description=""
              >
                {lophn
                  ? t("agents.label.lophn-role", {
                      workspace: scopeLabel(row.workspace, workspaceName, true),
                    })
                  : (row.description ?? t("agents.label.no-role"))}
              </p>
            </div>
            {lophn ? (
              <span className={styles.kind} data-agent-kind="">
                {t("agents.label.built-in")}
              </span>
            ) : null}
            {/* 정의 file이 틀린 agent는 옮길 값이 없어 복제하지 않는다. */}
            {row.glance === undefined ? null : (
              <Menu
                trigger={
                  <IconButton
                    icon={shellIcons.more}
                    label={t("agents.button.more-named", { name: row.name })}
                    size="sm"
                    variant="ghost"
                    data-card-menu=""
                  />
                }
                items={[
                  {
                    id: "duplicate",
                    label: t("agents.button.duplicate"),
                    data: { "data-menu-item": "duplicate" },
                    leading: <MenuIcon icon={actionIcons.duplicate} />,
                  },
                ]}
                onSelect={() => onDuplicate()}
              />
            )}
          </div>
          <CardGlance row={row} models={models} workspaceName={workspaceName} />
          {(row.card?.notes ?? []).map((note) => (
            <p key={note} className={styles.note} data-card-note="">
              {note}
            </p>
          ))}
          <div className={styles.actions}>
            <Button
              aria-label={t("project-workspace.label.open-agent-named", {
                name: row.name,
              })}
              trailingIcon={actionIcons.open}
              onClick={onOpen}
            >
              {t("project-workspace.button.open-agent")}
            </Button>
          </div>
        </div>
      </Card>
    </li>
  );
}

function Section({
  name,
  heading,
  action,
  children,
}: {
  name: string;
  heading: string;
  action?: ReactElement;
  children: ReactNode;
}): ReactElement {
  return (
    <section className={styles.section} data-section={name}>
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>{heading}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

// 지침 파일 안내. project는 repo의 AGENTS.md와 다른 파일이라는 말이고, Home과 앱은 파일이 어디 있는지 말한다.
function instructionsNote(kind: string, editable: boolean): string {
  if (kind === "home") return t("agents.notice.instructions-file-home");
  if (kind === "app") {
    return t(
      editable
        ? "agents.notice.instructions-file-app"
        : "agents.notice.instructions-file-app-none",
    );
  }
  return t("project-workspace.info.instructions-file");
}

export function AgentsTab(props: AgentsTabProps): ReactElement {
  const { overview } = props;
  const kind = kindOfWorkspace(props.workspace);
  const inherited = overview.workspaceModel.inherited;
  // 내장 coding agent는 lophn의 agent가 아니라 사람이 쓰는 제품이라 따로 묶는다.
  const lophnAgents = overview.agents.filter(
    (row) => !isCodingBuiltin(row.assignment),
  );
  const codingAgents = overview.agents.filter((row) =>
    isCodingBuiltin(row.assignment),
  );
  const card = (row: AgentListRow) => (
    <AgentCardView
      key={row.assignment}
      row={row}
      workspaceName={props.workspaceName}
      models={props.models}
      imageSrc={props.imageSrc}
      onOpen={() => props.onOpenAgent(row.assignment)}
      onDuplicate={() => props.onDuplicateAgent(row.assignment)}
    />
  );
  return (
    <div className={styles.page} data-agents-tab="">
      <h1 className={styles.title}>{t("project-workspace.heading.agents")}</h1>
      <p className={styles.lead}>
        {t(
          kind === "home"
            ? "agents.notice.tab-lead-home"
            : "agents.notice.tab-lead",
        )}
      </p>

      <Section
        name="agents"
        heading={t("agents.heading.all-agents")}
        action={
          <Button
            variant="primary"
            icon={actionIcons.add}
            onClick={props.onNewAgent}
          >
            {t("project-workspace.button.new-agent")}
          </Button>
        }
      >
        <ul className={styles.cards}>{lophnAgents.map(card)}</ul>
      </Section>

      {codingAgents.length === 0 ? null : (
        <Section
          name="coding-agents"
          heading={t("agents.heading.coding-agents")}
        >
          <p className={styles.note}>{t("agents.notice.coding-agents")}</p>
          <ul className={styles.cards}>{codingAgents.map(card)}</ul>
        </Section>
      )}

      <Section
        name="instructions"
        heading={t("project-workspace.heading.instructions")}
      >
        <InstructionsEditor
          head={t("project-workspace.label.instructions-shared", {
            workspace: props.workspaceName,
          })}
          file={overview.instructions}
          lines={PREVIEW_LINES}
          empty={t("project-workspace.empty.no-instructions")}
          port={props.instructions}
          editable={overview.instructions.editable}
        />
        <p className={styles.note}>
          {instructionsNote(kind, overview.instructions.editable)}
        </p>
      </Section>

      <Section name="memory" heading={t("agents.heading.memory")}>
        <InstructionsEditor
          head={t("agents.label.memory-head", {
            workspace: props.workspaceName,
          })}
          file={overview.memory}
          lines={PREVIEW_LINES}
          empty={t("agents.empty.memory")}
          port={props.memory}
          limit={MEMORY_MAX_BYTES}
        />
        <p className={styles.note}>
          {kind === "home"
            ? t("agents.notice.memory-home")
            : t("agents.notice.memory-workspace", {
                workspace: props.workspaceName,
              })}
        </p>
      </Section>

      <Section
        name="model"
        heading={t("agents.heading.model-for-workspace", { kind })}
      >
        <ModelField
          models={props.models}
          source={props.source}
          label={t("project-workspace.heading.agent-editor-model")}
          inheritLabel={
            inherited === null
              ? t("agents.label.model-unset-global")
              : t("agents.label.model-inherit", {
                  layer: "global",
                  model: inherited.model_name,
                })
          }
          inherited={inherited}
          value={overview.workspaceModel.chosen}
          layer={
            overview.workspaceModel.chosen === null
              ? inherited === null
                ? null
                : "global"
              : "project"
          }
          overrideNote={t("agents.label.model-overrides", { layer: "global" })}
          onChange={props.onWorkspaceModel}
        />
        <p className={styles.note}>
          {t("agents.notice.model-for-workspace", { kind })}
        </p>
      </Section>

      <Section
        name="skills"
        heading={t("project-workspace.heading.skills")}
        action={
          <Button size="sm" icon={actionIcons.add} onClick={props.onAddSkill}>
            {t("project-workspace.button.add-skill")}
          </Button>
        }
      >
        {overview.skills.length === 0 ? (
          <p className={styles.note}>
            {t("project-workspace.empty.no-skills")}
          </p>
        ) : (
          <SkillList items={overview.skills} onToggle={props.onToggleSkill} />
        )}
        <p className={styles.note}>
          {t("agents.notice.skills-workspace", { kind })}
        </p>
      </Section>

      <Section
        name="mcp"
        heading={t("project-workspace.heading.mcp-servers")}
        action={
          <Button size="sm" icon={actionIcons.add} onClick={props.onAddServer}>
            {t("project-workspace.button.add-server")}
          </Button>
        }
      >
        {overview.mcpServers.length === 0 ? (
          <p className={styles.note}>
            {t("project-workspace.empty.no-mcp-servers")}
          </p>
        ) : (
          <McpList items={overview.mcpServers} onToggle={props.onToggleMcp} />
        )}
      </Section>

      <p className={`${styles.note} ${styles.stored}`} data-stored-note="">
        {t("agents.notice.stored-in-lophn")}
      </p>
    </div>
  );
}

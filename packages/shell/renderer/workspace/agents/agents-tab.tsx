// project의 Agents 탭 본문(shell/workspace#R36·R37). 위에서부터 agent 카드(lophn · Context Engineer · Operator들),
// [+ New Operator], 그리고 Instructions · Models for this project · Skills · MCP servers · Permissions 구역과
// 맨 아래 "Agent definitions are stored in lophn, not in your project folder." 한 줄이다. 카드에는 일정·마지막
// 실행 줄이 없다. [Open]이 여는 editor는 editor/agent-editor.tsx가 맡고, 탭 안에서 본문을 바꾸는 일은 탭 쪽 몫이다.
//
// 약속하는 DOM(test가 단언): 카드는 `[data-agent-card]`(`data-assignment`, `data-role`, `data-kind`)가 위의 순서대로
// 나오고 안에 design `Avatar`, `[data-agent-name]`, `[data-agent-kind]`("Built in" | "Operator"), `[data-agent-model]`
// (model 이름), `[data-agent-counts]`("n contexts · n skills · n MCP", built-in은 contexts 없이), "Open" 단추가 있다.
// "New Operator" 단추가 마지막 카드 뒤에 있다. 구역은 `section[data-section=instructions|models|skills|mcp|permissions]`
// 이고 각자 h2 제목을 가진다. Instructions는 `[data-instructions-preview]`(LOPHN.md 첫 줄)와 "Edit" 단추, Models는 role마다
// `[data-role-model]`(`data-role`) 안에 `[data-role-label]`·`[data-role-model-line]`·`[data-model-button]`을 두며 고른
// 값이 있는 줄에만 "Use Workspace default" 단추가 있다. Skills·MCP servers·Permissions의 켬·끔은 design `Switch`다.
// 맨 아래 `[data-stored-note]`가 마지막 요소다.
import type { ReactElement, ReactNode } from "react";
import {
  Avatar,
  type AvatarProfile,
  Button,
  Card,
  lophnSpaceIcons,
  Switch,
} from "@lophn/design/components";
import { t } from "@lophn/wording";
import type { MessageKey } from "@lophn/wording";

import type {
  AgentListRow,
  ValueSource,
} from "../../../../protocol/lophn-agent/agent-values.ts";
import type { ModelChoice } from "../../../../protocol/lophn-agent/models.ts";
import type { AgentRole } from "../../../../protocol/lophn-agent/scope.ts";
import {
  ModelPicker,
  type ModelPickerProps,
} from "../../conversation/model-picker/model-picker.tsx";
import styles from "./agents-tab.module.css";
import type {
  ImageSrc,
  ModelLabel,
  PermissionRow,
  ProjectInstructionsView,
  ToggleRow,
} from "./views.ts";

/**
 * "Models for this project"의 줄 하나. role 넷(lophn · Context Engineer · App Engineer · Operators)이 이 순서로
 * 온다. 줄 이름은 role에서 화면이 만든다.
 */
export interface RoleModelRow {
  readonly role: AgentRole;
  /** 이 project가 고른 값(place settings의 models[role]). 비워 두었으면 null이다. */
  readonly chosen: ModelChoice | null;
  /**
   * 실제로 쓰는 값과 출처(ReadPlaceAgentSettings의 effective_models[role]). chosen이 있으면 출처 층은 place이고
   * 없으면 Workspace나 기본값이다. 아무 층에도 값이 없으면 null이다.
   */
  readonly effective: {
    readonly value: ModelChoice;
    readonly source: ValueSource;
  } | null;
  /** 이 줄에서 model과 option을 고르는 picker. */
  readonly picker: ModelPickerProps;
}

export interface AgentsTabProps {
  /** project 이름. "Shared by every agent in <project>"에 쓴다. */
  projectName: string;
  /**
   * ListAgents의 행을 보여 줄 순서대로: lophn, Context Engineer, Operator들. App Engineer는 앱 자리 agent라 이
   * 탭에 오지 않는다. 카드 개수(counts)는 행이 가진 값이다: built-in은 contexts가 null이라 그 수를 보이지 않는다.
   */
  agents: readonly AgentListRow[];
  imageSrc: ImageSrc;
  /** LOPHN.md. 이 탭은 첫 줄만 미리 보인다. */
  instructions: ProjectInstructionsView;
  modelRoles: readonly RoleModelRow[];
  modelLabel: ModelLabel;
  /** 이 project에 등록한 skill과 MCP server의 켬·끔. */
  skills: readonly ToggleRow[];
  mcpServers: readonly ToggleRow[];
  /** 이 project의 권한 규칙. 오래 가는 허락은 여기서만 정한다(platform/approvals). */
  permissions: readonly PermissionRow[];
  /** 카드의 [Open]. 같은 탭 안에서 그 agent의 editor를 연다. */
  onOpenAgent: (assignment: string, role: AgentRole) => void;
  /** [+ New Operator]. */
  onNewOperator: () => void;
  /** Instructions의 [Edit]. LOPHN.md의 문서 탭을 연다. */
  onEditInstructions: () => void;
  /** 고른 model 줄을 비워 Workspace 기본값을 따르게 한다. */
  onResetRoleModel: (role: AgentRole) => void;
  onToggleSkill: (name: string, on: boolean) => void;
  onAddSkill: () => void;
  onToggleMcp: (name: string, on: boolean) => void;
  onAddServer: () => void;
  onChangePermission: (tool: string, on: boolean) => void;
}

const ROLE_LABEL: Record<AgentRole, MessageKey> = {
  lophn: "project-workspace.label.role-lophn",
  context_engineer: "project-workspace.label.role-context-engineer",
  app_engineer: "project-workspace.label.role-app-engineer",
  operator: "project-workspace.label.role-operators",
};

function avatarProfile(row: AgentListRow, imageSrc: ImageSrc): AvatarProfile {
  return row.profile.kind === "icon"
    ? { kind: "icon", icon: row.profile.icon }
    : { kind: "image", src: imageSrc(row.assignment, row.profile.image) };
}

// 파일이 틀려 resolve하지 못한 행은 개수를 셀 수 없다(counts가 null).
function countsText(row: AgentListRow): string {
  const { contexts, skills, mcp } = row.counts;
  if (skills === null || mcp === null) {
    return t("project-workspace.label.agent-counts-unknown");
  }
  return contexts === null
    ? t("project-workspace.label.agent-counts-built-in", { skills, mcp })
    : t("project-workspace.label.agent-counts-operator", {
      contexts,
      skills,
      mcp,
    });
}

function AgentCardView(
  { row, imageSrc, onOpen }: {
    row: AgentListRow;
    imageSrc: ImageSrc;
    onOpen: () => void;
  },
): ReactElement {
  return (
    <li
      className={styles.card}
      data-agent-card=""
      data-assignment={row.assignment}
      data-role={row.role}
      data-kind={row.kind}
    >
      <Card>
        <div className={styles.cardBody}>
          <div className={styles.cardHead}>
            <Avatar profile={avatarProfile(row, imageSrc)} size="md" />
            <h3 className={styles.name} data-agent-name="">{row.name}</h3>
            <span className={styles.kind} data-agent-kind="">
              {t(
                row.kind === "built_in"
                  ? "project-workspace.label.agent-kind-built-in"
                  : "project-workspace.label.agent-kind-operator",
              )}
            </span>
          </div>
          <ul className={styles.facts}>
            <li data-agent-model="">
              {row.model?.model_name ??
                t("project-workspace.label.agent-no-model")}
            </li>
            <li data-agent-counts="">{countsText(row)}</li>
          </ul>
          <div className={styles.actions}>
            <Button
              aria-label={t("project-workspace.label.open-agent-named", {
                name: row.name,
              })}
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

function RoleModelView(
  { row, modelLabel, onReset }: {
    row: RoleModelRow;
    modelLabel: ModelLabel;
    onReset: () => void;
  },
): ReactElement {
  const role = t(ROLE_LABEL[row.role]);
  let line: string;
  if (row.chosen !== null) {
    line = t("project-workspace.label.model-overrides", {
      model: modelLabel(row.chosen),
    });
  } else if (row.effective !== null) {
    line = t("project-workspace.label.model-default", {
      model: modelLabel(row.effective.value),
    });
  } else {
    line = t("project-workspace.label.model-default-none");
  }
  return (
    <li className={styles.role} data-role-model="" data-role={row.role}>
      <span className={styles.roleLabel} data-role-label="">{role}</span>
      <span className={styles.roleLine} data-role-model-line="">{line}</span>
      <span className={styles.roleControls}>
        <ModelPicker {...row.picker} />
        {row.chosen !== null && (
          <Button
            size="sm"
            variant="ghost"
            aria-label={t("project-workspace.label.reset-model-named", {
              role,
            })}
            onClick={onReset}
          >
            {t("project-workspace.button.use-workspace-default")}
          </Button>
        )}
      </span>
    </li>
  );
}

function SwitchList(
  { rows, empty, onChange }: {
    rows: readonly { key: string; label: string; on: boolean }[];
    empty: string;
    onChange: (key: string, on: boolean) => void;
  },
): ReactElement {
  if (rows.length === 0) return <p className={styles.note}>{empty}</p>;
  return (
    <ul className={styles.toggles}>
      {rows.map((row) => (
        <li key={row.key} className={styles.toggle}>
          <Switch
            label={row.label}
            checked={row.on}
            onCheckedChange={(on) => onChange(row.key, on)}
          />
        </li>
      ))}
    </ul>
  );
}

function Section(
  { name, heading, action, children }: {
    name: string;
    heading: string;
    action?: ReactElement;
    children: ReactNode;
  },
): ReactElement {
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

function toggleRows(rows: readonly ToggleRow[]) {
  return rows.map((row) => ({ key: row.name, label: row.name, on: row.on }));
}

export function AgentsTab(props: AgentsTabProps): ReactElement {
  const preview = props.instructions.text.split("\n").find((line) =>
    line.trim() !== ""
  );
  return (
    <div className={styles.page} data-agents-tab="">
      <h1 className={styles.title}>
        {t("project-workspace.heading.agents-in-project", {
          project: props.projectName,
        })}
      </h1>
      <ul className={styles.cards}>
        {props.agents.map((row) => (
          <AgentCardView
            key={row.assignment}
            row={row}
            imageSrc={props.imageSrc}
            onOpen={() => props.onOpenAgent(row.assignment, row.role)}
          />
        ))}
      </ul>
      <div>
        <Button
          variant="primary"
          icon={lophnSpaceIcons.add}
          onClick={props.onNewOperator}
        >
          {t("project-workspace.button.new-operator")}
        </Button>
      </div>
      <Section
        name="instructions"
        heading={t("project-workspace.heading.instructions")}
        action={
          <Button size="sm" onClick={props.onEditInstructions}>
            {t("project-workspace.button.edit-instructions")}
          </Button>
        }
      >
        <p className={styles.lead}>
          {t("project-workspace.label.instructions-shared", {
            project: props.projectName,
          })}
        </p>
        {preview === undefined
          ? (
            <p className={styles.note}>
              {t("project-workspace.empty.no-instructions")}
            </p>
          )
          : (
            <pre className={styles.preview} data-instructions-preview="">
              {preview}
            </pre>
          )}
        <p className={styles.note}>
          {t("project-workspace.info.instructions-file")}
        </p>
      </Section>
      <Section
        name="models"
        heading={t("project-workspace.heading.models-for-project")}
      >
        <ul className={styles.roles}>
          {props.modelRoles.map((row) => (
            <RoleModelView
              key={row.role}
              row={row}
              modelLabel={props.modelLabel}
              onReset={() => props.onResetRoleModel(row.role)}
            />
          ))}
        </ul>
        <p className={styles.note}>
          {t("project-workspace.info.models-follow-default")}
        </p>
      </Section>
      <Section
        name="skills"
        heading={t("project-workspace.heading.skills")}
        action={
          <Button
            size="sm"
            icon={lophnSpaceIcons.add}
            onClick={props.onAddSkill}
          >
            {t("project-workspace.button.add-skill")}
          </Button>
        }
      >
        <SwitchList
          rows={toggleRows(props.skills)}
          empty={t("project-workspace.empty.no-skills")}
          onChange={props.onToggleSkill}
        />
      </Section>
      <Section
        name="mcp"
        heading={t("project-workspace.heading.mcp-servers")}
        action={
          <Button
            size="sm"
            icon={lophnSpaceIcons.add}
            onClick={props.onAddServer}
          >
            {t("project-workspace.button.add-server")}
          </Button>
        }
      >
        <SwitchList
          rows={toggleRows(props.mcpServers)}
          empty={t("project-workspace.empty.no-mcp-servers")}
          onChange={props.onToggleMcp}
        />
      </Section>
      <Section
        name="permissions"
        heading={t("project-workspace.heading.permissions")}
      >
        <p className={styles.lead}>
          {t("project-workspace.info.permissions-lead")}
        </p>
        <SwitchList
          rows={props.permissions.map((rule) => ({
            key: rule.tool,
            label: rule.label,
            on: rule.on,
          }))}
          empty={t("project-workspace.empty.no-permission-rules")}
          onChange={props.onChangePermission}
        />
      </Section>
      <p className={`${styles.note} ${styles.stored}`} data-stored-note="">
        {t("project-workspace.info.stored-in-lophn")}
      </p>
    </div>
  );
}

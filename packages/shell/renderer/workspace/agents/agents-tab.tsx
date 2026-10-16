// project의 Agents 탭 본문. 위에서부터 Project Manager 카드(project마다 하나), 이 project의 Operator 카드들과
// [New Operator], 같이 쓰는 LOPHN.md, project 층 model 하나, skill, MCP server와 맨 아래 "Agent definitions are stored in
// lophn, not in your project folder." 한 줄이다. lophn은 전체에 하나라 이 탭에 없고 Workspace Settings에서 정한다.
// 앱 자리에서는 Project Manager 자리에 그 앱의 App Engineer가 온다. [Open]이 여는 editor는 editor/agent-editor.tsx가 맡는다.
import type { ReactElement, ReactNode } from "react";
import {
  Avatar,
  type AvatarProfile,
  Button,
  Card,
} from "@lophn/design/components";
import { t } from "@lophn/wording";

import type { ModelChoice } from "../../../../protocol/lophn-agent/models.ts";
import { lophnSpaceIcons } from "../../icons/mod.ts";
import { ModelField } from "./editor/model-field.tsx";
import { McpList, ROLE_LABEL, SkillList } from "./editor/parts.tsx";
import styles from "./agents-tab.module.css";
import type { AgentListRow, AgentsOverview, ModelsView } from "./source.ts";
import type { ImageSrc } from "./views.ts";

interface AgentsTabProps {
  /** project(앱 자리면 앱) 이름. */
  readonly projectName: string;
  readonly overview: AgentsOverview;
  readonly models: ModelsView | null;
  readonly imageSrc: ImageSrc;
  /** 카드의 [Open]. 같은 탭 안에서 그 agent의 editor를 연다. */
  readonly onOpenAgent: (assignment: string) => void;
  /** [New Operator]. */
  readonly onNewOperator: () => void;
  /** Instructions의 [Edit]. LOPHN.md의 문서 탭을 연다. */
  readonly onEditInstructions: () => void;
  readonly onProjectModel: (choice: ModelChoice | null) => void;
  readonly onToggleSkill: (name: string, on: boolean) => void;
  readonly onAddSkill: () => void;
  readonly onToggleMcp: (name: string, on: boolean) => void;
  readonly onAddServer: () => void;
}

/** 카드 미리보기로 보이는 LOPHN.md 줄 수. */
const PREVIEW_LINES = 3;

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
              {t(ROLE_LABEL[row.role])}
            </span>
          </div>
          <ul className={styles.facts}>
            <li data-agent-model="">
              {row.model === null
                ? t("project-workspace.label.agent-no-model")
                : t("agents.label.card-model", {
                  layer: row.model.source,
                  model: row.model.model_name,
                })}
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

export function AgentsTab(props: AgentsTabProps): ReactElement {
  const { overview } = props;
  const builtIn = overview.agents.filter((row) => row.kind === "built_in");
  const operators = overview.agents.filter((row) => row.kind === "operator");
  const preview = overview.instructions.text.split("\n").slice(0, PREVIEW_LINES)
    .join("\n");
  const inherited = overview.projectModel.inherited;
  return (
    <div className={styles.page} data-agents-tab="">
      <h1 className={styles.title}>
        {t("project-workspace.heading.agents-in-project", {
          project: props.projectName,
        })}
      </h1>
      <p className={styles.lead}>{t("agents.notice.tab-lead")}</p>

      {builtIn.map((row) => (
        <Section
          key={row.assignment}
          name="built-in"
          heading={t(ROLE_LABEL[row.role])}
        >
          <ul className={styles.cards}>
            <AgentCardView
              row={row}
              imageSrc={props.imageSrc}
              onOpen={() => props.onOpenAgent(row.assignment)}
            />
          </ul>
        </Section>
      ))}

      <Section
        name="operators"
        heading={t("project-workspace.label.role-operators")}
        action={
          <Button
            variant="primary"
            icon={lophnSpaceIcons.add}
            onClick={props.onNewOperator}
          >
            {t("project-workspace.button.new-operator")}
          </Button>
        }
      >
        <ul className={styles.cards}>
          {operators.map((row) => (
            <AgentCardView
              key={row.assignment}
              row={row}
              imageSrc={props.imageSrc}
              onOpen={() => props.onOpenAgent(row.assignment)}
            />
          ))}
        </ul>
      </Section>

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
        {preview.trim() === ""
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
        name="model"
        heading={t("agents.heading.model-for-project")}
      >
        <ModelField
          models={props.models}
          label={t("project-workspace.heading.agent-editor-model")}
          inheritLabel={inherited === null
            ? t("project-workspace.label.agent-editor-model-unset")
            : t("agents.label.model-inherit", {
              layer: "global",
              model: inherited.model_name,
            })}
          inherited={inherited}
          value={overview.projectModel.chosen}
          overrideNote={t("agents.label.model-overrides", { layer: "global" })}
          onChange={props.onProjectModel}
        />
        <p className={styles.note}>{t("agents.notice.model-for-project")}</p>
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
        {overview.skills.length === 0
          ? (
            <p className={styles.note}>
              {t("project-workspace.empty.no-skills")}
            </p>
          )
          : (
            <SkillList
              items={overview.skills}
              onToggle={props.onToggleSkill}
            />
          )}
        <p className={styles.note}>{t("agents.notice.skills-project")}</p>
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
        {overview.mcpServers.length === 0
          ? (
            <p className={styles.note}>
              {t("project-workspace.empty.no-mcp-servers")}
            </p>
          )
          : (
            <McpList
              items={overview.mcpServers}
              onToggle={props.onToggleMcp}
            />
          )}
      </Section>

      <p className={`${styles.note} ${styles.stored}`} data-stored-note="">
        {t("agents.notice.stored-in-lophn")}
      </p>
    </div>
  );
}

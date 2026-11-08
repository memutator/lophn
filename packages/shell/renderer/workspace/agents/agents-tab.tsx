// project의 Agents 탭 본문. 위에서부터 전역 agent와 이 workspace 범위 agent의 카드 목록(lophn이 첫 줄)과 [New agent], 같이 쓰는 LOPHN.md,
// project 층 model 하나, skill, MCP server와 맨 아래 "Agent definitions are stored in lophn, not in your project folder."
// 한 줄이다. [Open]이 여는 editor는 editor/agent-editor.tsx가 맡는다.

import { Card } from "@lophn/ui/layout";
import { Button } from "@lophn/ui/primitives";
import { t } from "@lophn/i18n";
import type { ReactElement, ReactNode } from "react";
import type { ModelChoice } from "../../../../protocol/lophn-agent/models.ts";
import { actionIcons } from "../../icons/mod.ts";
import { Avatar, type AvatarProfile } from "../../parts/avatar/avatar.tsx";
import { CardFacts, scopeLabel } from "./agent-card.tsx";
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
  /** project(앱 자리면 앱) 이름. */
  readonly projectName: string;
  readonly overview: AgentsOverview;
  readonly models: ModelsView | null;
  /** Model 칸이 목록을 다시 읽는 통로. */
  readonly source: ModelFieldSource;
  readonly imageSrc: ImageSrc;
  /** 카드의 [Open]. 같은 탭 안에서 그 agent의 editor를 연다. */
  readonly onOpenAgent: (assignment: string) => void;
  /** [New agent]. */
  readonly onNewAgent: () => void;
  /** Instructions의 LOPHN.md를 이 자리에서 고치는 길. */
  readonly instructions: InstructionsPort;
  readonly onProjectModel: (choice: ModelChoice | null) => void;
  readonly onToggleSkill: (name: string, on: boolean) => void;
  readonly onAddSkill: () => void;
  readonly onToggleMcp: (name: string, on: boolean) => void;
  readonly onAddServer: () => void;
}

/** 미리보기로 보이는 LOPHN.md 줄 수. */
const PREVIEW_LINES = 3;

function avatarProfile(row: AgentListRow, imageSrc: ImageSrc): AvatarProfile {
  return row.profile.kind === "character"
    ? row.profile
    : { kind: "image", src: imageSrc(row.assignment, row.profile.image) };
}

// 파일이 틀려 resolve하지 못한 행은 개수를 셀 수 없다(counts가 null).
function countsText(row: AgentListRow): string {
  const { skills, mcp } = row.counts;
  if (skills === null || mcp === null) {
    return t("project-workspace.label.agent-counts-unknown");
  }
  return t("project-workspace.label.agent-counts", { skills, mcp });
}

function AgentCardView({
  row,
  workspaceName,
  imageSrc,
  onOpen,
}: {
  row: AgentListRow;
  workspaceName: string;
  imageSrc: ImageSrc;
  onOpen: () => void;
}): ReactElement {
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
            <h3 className={styles.name} data-agent-name="">
              {row.name}
            </h3>
            {row.assignment === "lophn" ? (
              <span className={styles.kind} data-agent-kind="">
                {t("agents.label.built-in")}
              </span>
            ) : null}
          </div>
          {row.description === undefined ? null : (
            <p className={styles.description} data-agent-description="">
              {row.description}
            </p>
          )}
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
            {/* 명함이 없는 줄(틀린 정의 file)은 범위를 여기서 보인다. */}
            {row.card === undefined ? (
              <li data-agent-scope="">
                {scopeLabel(row.workspace, workspaceName)}
              </li>
            ) : null}
          </ul>
          {row.card === undefined ? null : (
            <CardFacts card={row.card} workspaceName={workspaceName} />
          )}
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

export function AgentsTab(props: AgentsTabProps): ReactElement {
  const { overview } = props;
  const inherited = overview.projectModel.inherited;
  return (
    <div className={styles.page} data-agents-tab="">
      <h1 className={styles.title}>{t("project-workspace.heading.agents")}</h1>
      <p className={styles.lead}>{t("agents.notice.tab-lead")}</p>

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
        <ul className={styles.cards}>
          {overview.agents.map((row) => (
            <AgentCardView
              key={row.assignment}
              row={row}
              workspaceName={props.projectName}
              imageSrc={props.imageSrc}
              onOpen={() => props.onOpenAgent(row.assignment)}
            />
          ))}
        </ul>
      </Section>

      {overview.instructions === null ? null : (
        <Section
          name="instructions"
          heading={t("project-workspace.heading.instructions")}
        >
          <InstructionsEditor
            head={t("project-workspace.label.instructions-shared", {
              project: props.projectName,
            })}
            file={overview.instructions}
            lines={PREVIEW_LINES}
            empty={t("project-workspace.empty.no-instructions")}
            port={props.instructions}
          />
          <p className={styles.note}>
            {t("project-workspace.info.instructions-file")}
          </p>
        </Section>
      )}

      <Section name="model" heading={t("agents.heading.model-for-project")}>
        <ModelField
          models={props.models}
          source={props.source}
          label={t("project-workspace.heading.agent-editor-model")}
          inheritLabel={
            inherited === null
              ? t("project-workspace.label.agent-editor-model-unset")
              : t("agents.label.model-inherit", {
                  layer: "global",
                  model: inherited.model_name,
                })
          }
          inherited={inherited}
          value={overview.projectModel.chosen}
          layer={
            overview.projectModel.chosen === null
              ? inherited === null
                ? null
                : "global"
              : "project"
          }
          overrideNote={t("agents.label.model-overrides", { layer: "global" })}
          onChange={props.onProjectModel}
        />
        <p className={styles.note}>{t("agents.notice.model-for-project")}</p>
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
        <p className={styles.note}>{t("agents.notice.skills-project")}</p>
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

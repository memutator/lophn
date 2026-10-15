// project의 Agents 탭. Project Manager 카드(project마다 하나)와 이 project의 Operator들, 같이 쓰는 지침(LOPHN.md),
// project 층 model 하나, skill, MCP server가 있다. lophn은 전체에 하나라 여기 없고 Workspace Settings에서 정한다.
import { useState } from "react";
import { Button, Card } from "@lophn/design/components";
import {
  lophnSpaceIcons,
} from "../../../../../packages/shell/renderer/icons/mod.ts";

import { ProfileAvatar } from "../agent-avatar.tsx";
import { type ModelSelection, selectionLabel } from "../model-options.ts";
import { ModelField } from "../model-picker.tsx";
import type { TabSpec } from "../project-window.tsx";
import { McpList, SkillList } from "./parts.tsx";
import {
  type AgentSpec,
  agentTab,
  GLOBAL_MODEL,
  LOPHN_MD_PREVIEW,
  MANAGER,
  MCP_SERVERS,
  OPERATORS,
  PROJECT,
  PROJECT_MODEL,
  SKILLS,
} from "./setup-data.ts";
import s from "./agent-setup.module.css";

type Open = (tab: TabSpec, other?: boolean) => void;

const count = (n: number, one: string) =>
  n === 0 ? `No ${one}s` : `${n} ${one}${n === 1 ? "" : "s"}`;

function AgentCard(
  { agent, projectModel, open }: {
    agent: AgentSpec;
    projectModel: ModelSelection | null;
    open: Open;
  },
) {
  const model = agent.model !== null
    ? `Model: ${selectionLabel(agent.model)}`
    : `Model: ${projectModel === null ? "Workspace" : "project"} default (${
      selectionLabel(projectModel ?? GLOBAL_MODEL)
    })`;
  const skills = SKILLS.filter((item) => !agent.skillsOff.includes(item.name))
    .length;
  return (
    <Card>
      <div className={s.cardHead}>
        <h3 className={s.cardTitle}>
          <ProfileAvatar profile={agent.profile} size="md" />
          {agent.name}
        </h3>
        <span className={s.chip}>{agent.role}</span>
      </div>
      <p className={s.purpose}>{agent.summary}</p>
      <ul className={s.rows}>
        <li>{model}</li>
        <li>
          {agent.role === "Operator"
            ? `${count(agent.contexts.length, "context")} · `
            : ""}
          {count(skills, "skill")} · {agent.mcpOn.length} MCP
        </li>
      </ul>
      <div className={s.actions}>
        <Button onClick={() => open(agentTab(agent.id))}>Open</Button>
      </div>
    </Card>
  );
}

export function ProjectAgentsBody({ open }: { open: Open }) {
  const [model, setModel] = useState<ModelSelection | null>(PROJECT_MODEL);
  return (
    <div className={s.page}>
      <h1 className={s.title}>Agents in {PROJECT}</h1>
      <p className={s.lead}>
        The agents that work in this project. lophn is one agent for all of
        lophn, so you set it up in Workspace Settings › Agents.
      </p>

      <section>
        <div className={s.sectionHead}>
          <h2 className={s.sectionTitle}>Project Manager</h2>
        </div>
        <div className={s.cards}>
          <AgentCard agent={MANAGER} projectModel={model} open={open} />
        </div>
      </section>

      <section className={s.section}>
        <div className={s.sectionHead}>
          <h2 className={s.sectionTitle}>Operators</h2>
          <Button
            variant="primary"
            icon={lophnSpaceIcons.add}
            onClick={() => open(agentTab("new"))}
          >
            New Operator
          </Button>
        </div>
        <div className={s.cards}>
          {OPERATORS.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              projectModel={model}
              open={open}
            />
          ))}
        </div>
      </section>

      <section className={s.section}>
        <div className={s.sectionHead}>
          <h2 className={s.sectionTitle}>Instructions</h2>
          <Button size="sm">Edit</Button>
        </div>
        <p className={s.sectionLead}>
          LOPHN.md · Shared by every agent in {PROJECT}
        </p>
        <pre className={s.code}>
          {LOPHN_MD_PREVIEW.split("\n").slice(0, 3).join("\n")}
        </pre>
        <p className={s.note}>
          Your project's AGENTS.md is for coding agents; lophn agents read
          LOPHN.md.
        </p>
      </section>

      <section className={s.section}>
        <div className={s.sectionHead}>
          <h2 className={s.sectionTitle}>Model for this project</h2>
        </div>
        <ModelField
          label="Model"
          inheritLabel={`Use Workspace default — ${
            selectionLabel(GLOBAL_MODEL)
          }`}
          inherited={GLOBAL_MODEL}
          value={model}
          onChange={setModel}
          overrideNote="Overrides Workspace"
        />
        <p className={s.note}>
          One model for every agent in this project. An agent can pick its own
          in its settings.
        </p>
      </section>

      <section className={s.section}>
        <div className={s.sectionHead}>
          <h2 className={s.sectionTitle}>Skills</h2>
          <Button size="sm" icon={lophnSpaceIcons.add}>Add skill</Button>
        </div>
        <SkillList items={SKILLS} />
        <p className={s.note}>
          A switch turns a skill on or off for this project. Workspace skills
          can be turned off here too.
        </p>
      </section>

      <section className={s.section}>
        <div className={s.sectionHead}>
          <h2 className={s.sectionTitle}>MCP servers</h2>
          <Button size="sm" icon={lophnSpaceIcons.add}>Add server</Button>
        </div>
        <McpList items={MCP_SERVERS} />
      </section>

      <p className={`${s.note} ${s.stored}`}>
        Agent definitions are stored in lophn, not in your project folder.
      </p>
    </div>
  );
}

// Lophn Workspace › Settings › Agents와 Tools and skills. Agents는 전역 기본 model 하나, lophn의 설정(전체에 하나), 전역 지침,
// grant 기본값 설명이고 Tools and skills는 전역 skill과 MCP server다. lophn의 설정 화면은 같은 agent 설정 화면이다.
// 조각은 renderer의 workspace/agents/editor와 fake source에서 온다.
import { useEffect, useMemo, useState } from "react";
import { Button, Card } from "@lophn/design/components";
import {
  lophnSpaceIcons,
} from "../../../../../packages/shell/renderer/icons/mod.ts";

import type { ModelChoice } from "../../../../../packages/protocol/lophn-agent/models.ts";
import { AgentEditor } from "../../../../../packages/shell/renderer/workspace/agents/editor/agent-editor.tsx";
import { DefaultsTable } from "../../../../../packages/shell/renderer/workspace/agents/editor/grants-panel.tsx";
import { DefaultModelField } from "../../../../../packages/shell/renderer/workspace/agents/editor/model-field.tsx";
import {
  McpList,
  SkillList,
} from "../../../../../packages/shell/renderer/workspace/agents/editor/parts.tsx";
import {
  createFakeAgentsSource,
  FAKE_AGENTS,
  FAKE_GRANTS,
  GLOBAL_LOPHN_MD,
  GLOBAL_MCP,
  GLOBAL_MODEL,
  GLOBAL_SKILLS,
} from "../../../../../packages/shell/renderer/workspace/agents/fake-source.ts";
import { modelLabelOf } from "../../../../../packages/shell/renderer/workspace/agents/model-picker-data.ts";
import type { ModelsView } from "../../../../../packages/shell/renderer/workspace/agents/source.ts";

import { ProfileAvatar } from "../agent-avatar.tsx";
import s from "./settings-agents.module.css";

const LOPHN = FAKE_AGENTS[0];

/** fake source가 주는 model catalog. 읽는 동안은 null이다. */
function useModels(): ModelsView | null {
  const [models, setModels] = useState<ModelsView | null>(null);
  useEffect(() => {
    void createFakeAgentsSource().models().then((result) => {
      if (result.ok) setModels(result.value);
    });
  }, []);
  return models;
}

/** Settings › Agents 목록 화면. */
export function SettingsAgents({ onOpenLophn }: { onOpenLophn: () => void }) {
  const models = useModels();
  const [model, setModel] = useState<ModelChoice>(GLOBAL_MODEL);
  const grants = FAKE_GRANTS.lophn;
  const apps = grants.filter((entry) => entry.kind === "app").length;
  const agents = grants.filter((entry) => entry.kind === "agent").length;
  return (
    <div className={s.settingsPage}>
      <h1 className={s.title}>Agents</h1>
      <p className={s.lead}>
        Defaults for every project. A project or an agent can change them.
      </p>

      <section>
        <h2 className={s.sectionTitle}>Default model</h2>
        <p className={s.sectionLead}>
          One model for every agent. A project, or an agent's own settings, can
          pick another.
        </p>
        <DefaultModelField models={models} value={model} onChange={setModel} />
      </section>

      <section className={s.section}>
        <h2 className={s.sectionTitle}>lophn</h2>
        <Card>
          <div className={s.cardHead}>
            <h3 className={s.cardTitle}>
              <ProfileAvatar profile={{ icon: "dock" }} size="md" />
              {LOPHN.name}
            </h3>
            <span className={s.chip}>One for all of lophn</span>
          </div>
          <p className={s.purpose}>{LOPHN.summary}</p>
          <ul className={s.rows}>
            <li>Model: Use default ({modelLabelOf(models)(model)})</li>
            <li>
              Grants: {apps} apps · {agents}{" "}
              agents it can call · may change settings
            </li>
          </ul>
          <div className={s.actions}>
            <Button onClick={onOpenLophn}>Open lophn settings</Button>
          </div>
        </Card>
      </section>

      <section className={s.section}>
        <div className={s.sectionHead}>
          <h2 className={s.sectionTitle}>Instructions for all projects</h2>
          <Button size="sm">Edit</Button>
        </div>
        <p className={s.sectionLead}>
          <span className={s.mono}>~/.lophn/LOPHN.md</span>
        </p>
        <pre className={s.code}>{GLOBAL_LOPHN_MD}</pre>
        <p className={s.note}>
          Skills and MCP servers for all projects are in Tools and skills.
        </p>
      </section>

      <section className={s.section}>
        <h2 className={s.sectionTitle}>Grant defaults</h2>
        <p className={s.sectionLead}>
          When you give an agent an app, a tool or another agent, it starts with
          these. Each agent's Grants tab can change any of them.
        </p>
        <DefaultsTable />
      </section>
    </div>
  );
}

/** Settings › Agents › lophn. 같은 agent 설정 화면이다. */
export function SettingsLophn({ onBack }: { onBack: () => void }) {
  const source = useMemo(() => createFakeAgentsSource(), []);
  const noop = () => {};
  return (
    <div className={s.settingsPage}>
      <div className={s.backRow}>
        <Button size="sm" variant="ghost" onClick={onBack}>‹ Agents</Button>
      </div>
      <AgentEditor
        source={source}
        project={null}
        projectName=""
        agent="lophn"
        contexts={[]}
        onDone={onBack}
        onChanged={noop}
        onEditProjectInstructions={noop}
      />
    </div>
  );
}

/** Settings › Tools and skills. 전역 층의 skill 켬·끔과 MCP server. */
export function SettingsTools() {
  const [skillsOff, setSkillsOff] = useState<readonly string[]>([]);
  const [mcpOff, setMcpOff] = useState<readonly string[]>(
    GLOBAL_MCP.filter((item) => !item.on).map((item) => item.name),
  );
  const flip = (list: readonly string[], name: string, on: boolean) =>
    on ? list.filter((one) => one !== name) : [...list, name];
  return (
    <div className={s.settingsPage}>
      <h1 className={s.title}>Tools and skills</h1>
      <p className={s.lead}>
        The Workspace layer, shared by every project. A project can turn an item
        off for itself, and an agent can turn it off for itself too.
      </p>

      <section>
        <div className={s.sectionHead}>
          <h2 className={s.sectionTitle}>Skills (all projects)</h2>
          <Button size="sm" icon={lophnSpaceIcons.add}>Add skill</Button>
        </div>
        <SkillList
          items={GLOBAL_SKILLS}
          offNames={skillsOff}
          showLayer={false}
          onToggle={(name, on) => setSkillsOff(flip(skillsOff, name, on))}
        />
        <p className={s.note}>
          Skill folders follow the Agent Skills format (SKILL.md). lophn has no
          built-in skills yet.
        </p>
      </section>

      <section className={s.section}>
        <div className={s.sectionHead}>
          <h2 className={s.sectionTitle}>MCP servers (all projects)</h2>
          <Button size="sm" icon={lophnSpaceIcons.add}>Add server</Button>
        </div>
        <McpList
          items={GLOBAL_MCP.map((item) => ({ ...item, on: true }))}
          offNames={mcpOff}
          showLayer={false}
          onToggle={(name, on) => setMcpOff(flip(mcpOff, name, on))}
        />
        <p className={s.note}>
          Import from .mcp.json. A server with the same name in a project or an
          agent replaces this one for that layer.
        </p>
      </section>
    </div>
  );
}

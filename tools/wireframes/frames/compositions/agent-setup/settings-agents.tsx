// Lophn Workspace › Settings › Agents와 Tools and skills. Agents는 전역 기본 model 하나, lophn의 설정(전체에 하나), 전역 지침,
// grant 기본값 설명이고 Tools and skills는 전역 skill과 MCP server다. lophn의 설정 화면은 같은 agent 설정 화면이다.
import { useState } from "react";
import { Button, Card } from "@lophn/design/components";
import {
  lophnSpaceIcons,
} from "../../../../../packages/shell/renderer/icons/mod.ts";

import { ProfileAvatar } from "../agent-avatar.tsx";
import { type ModelSelection, selectionLabel } from "../model-options.ts";
import { AgentEditor } from "./agent-editor.tsx";
import { DefaultsTable } from "./grants-panel.tsx";
import { DefaultModelField, McpList, SkillList } from "./parts.tsx";
import {
  GLOBAL_LOPHN_MD_PREVIEW,
  GLOBAL_MCP,
  GLOBAL_MODEL,
  GLOBAL_SKILLS,
  GRANTS,
  LOPHN,
} from "./setup-data.ts";
import s from "./agent-setup.module.css";

/** Settings › Agents 목록 화면. */
export function SettingsAgents({ onOpenLophn }: { onOpenLophn: () => void }) {
  const [model, setModel] = useState<ModelSelection>(GLOBAL_MODEL);
  const grants = GRANTS[LOPHN.id];
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
        <DefaultModelField value={model} onChange={setModel} />
      </section>

      <section className={s.section}>
        <h2 className={s.sectionTitle}>lophn</h2>
        <Card>
          <div className={s.cardHead}>
            <h3 className={s.cardTitle}>
              <ProfileAvatar profile={LOPHN.profile} size="md" />
              {LOPHN.name}
            </h3>
            <span className={s.chip}>One for all of lophn</span>
          </div>
          <p className={s.purpose}>{LOPHN.summary}</p>
          <ul className={s.rows}>
            <li>Model: Use default ({selectionLabel(model)})</li>
            <li>
              Grants: {grants.apps.length} apps · {grants.agents.length}{" "}
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
        <pre className={s.code}>{GLOBAL_LOPHN_MD_PREVIEW}</pre>
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
  return (
    <div className={s.settingsPage}>
      <div className={s.backRow}>
        <Button size="sm" variant="ghost" onClick={onBack}>‹ Agents</Button>
      </div>
      <AgentEditor id={LOPHN.id} onDone={onBack} />
    </div>
  );
}

/** Settings › Tools and skills. 전역 층의 skill 켬·끔과 MCP server. */
export function SettingsTools() {
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
        <SkillList items={GLOBAL_SKILLS} showLayer={false} />
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
        <McpList items={GLOBAL_MCP} showLayer={false} />
        <p className={s.note}>
          Import from .mcp.json. A server with the same name in a project or an
          agent replaces this one for that layer.
        </p>
      </section>
    </div>
  );
}

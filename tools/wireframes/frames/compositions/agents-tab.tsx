// project의 Agents 탭(A7)과 agent 편집 탭(A8). 카드 목록과 Instructions·Models for this project·Skills·MCP
// servers section, 그리고 agent 하나의 form(Profile · Name · Instructions · Model · Contexts · Skills · MCP ·
// Permissions). 정의는 project 폴더가 아니라 lophn에 저장된다.
import { useState } from "react";
import {
  Button,
  Card,
  Checkbox,
  Field,
  Icon,
  iconPixels,
  Input,
  lophnSpaceIcons,
  Menu,
  Select,
  Switch,
  Textarea,
} from "@lophn/design/components";

import {
  AVATAR_ICON_LABEL,
  AVATAR_ICONS,
  ProfileAvatar,
} from "./agent-avatar.tsx";
import {
  type AgentProfile,
  AVATAR_ICON_KEYS,
  effectiveRoleModel,
  LOPHN_MD_PREVIEW,
  operatorOf,
  OPERATORS,
  operatorTab,
  profileOf,
  PROJECT_CONTEXTS,
  PROJECT_MCP,
  PROJECT_SKILLS,
  ROLE_MODELS,
  roleModel,
  type ToggleItem,
} from "./agents-data.ts";
import { type ModelSelection, selectionLabel } from "./model-options.ts";
import { ModelField } from "./model-picker.tsx";
import type { TabSpec } from "./project-window.tsx";
import styles from "./compose.module.css";
import a from "./agents.module.css";

type Open = (tab: TabSpec, other?: boolean) => void;

const STATUS_TEXT = {
  connected: "Connected",
  "needs-sign-in": "Needs sign-in",
  off: "Off",
} as const;

/** 켬/끔 줄 목록(skill·MCP server). MCP는 이름 옆에 상태 점이 있다. */
export function ToggleList({ items }: { items: readonly ToggleItem[] }) {
  return (
    <ul className={a.toggleList}>
      {items.map((item) => (
        <li key={item.name} className={a.toggleRow}>
          <span className={a.toggleName}>
            {item.status === undefined ? null : (
              <span
                className={`${a.stateDot} ${a[`mcp_${item.status}`]}`}
                role="img"
                aria-label={STATUS_TEXT[item.status]}
                title={STATUS_TEXT[item.status]}
              />
            )}
            <Switch label={item.name} defaultChecked={item.on} />
          </span>
          <span className={a.toggleDetail}>
            {item.detail}
            {item.status === undefined ? "" : ` · ${STATUS_TEXT[item.status]}`}
          </span>
        </li>
      ))}
    </ul>
  );
}

const count = (n: number, one: string, many = `${one}s`) =>
  n === 0 ? `No ${many}` : `${n} ${n === 1 ? one : many}`;

interface AgentCard {
  readonly id: string;
  readonly name: string;
  readonly kind: "Built in" | "Operator";
  readonly text?: string;
  readonly model: string;
  readonly counts: string;
}

const onCount = (items: readonly ToggleItem[]) =>
  items.filter((item) => item.on).length;

function cards(): readonly AgentCard[] {
  const builtIn = (id: string, name: string, role: string, text: string) => {
    const row = roleModel(role);
    return {
      id,
      name,
      kind: "Built in" as const,
      text,
      model: row.project === null
        ? `Model: default (${selectionLabel(effectiveRoleModel(role))})`
        : `Model: ${selectionLabel(row.project)} (project)`,
      counts: `${count(onCount(PROJECT_SKILLS), "skill")} · ${
        onCount(PROJECT_MCP)
      } MCP`,
    };
  };
  return [
    builtIn("lophn", "lophn", "lophn", "Talks with you about this project."),
    builtIn(
      "engineer",
      "Context Engineer",
      "Context Engineer",
      "Keeps contexts and searches in shape.",
    ),
    ...OPERATORS.map((operator) => ({
      id: operator.id,
      name: operator.name,
      kind: "Operator" as const,
      model: operator.model === null
        ? `Model: default (${selectionLabel(effectiveRoleModel("Operators"))})`
        : `Model: ${selectionLabel(operator.model)}`,
      counts: `${count(operator.contexts.length, "context")} · ${
        count(operator.skills.length, "skill")
      } · ${
        operator.mcp.length === 0 ? "No MCP" : `${operator.mcp.length} MCP`
      }`,
    })),
  ];
}

/** project 한 층의 model 칸 셋(role별). 비우면 Workspace 기본값을 따른다. */
function ProjectModels() {
  const [chosen, setChosen] = useState<Record<string, ModelSelection | null>>(
    Object.fromEntries(ROLE_MODELS.map((row) => [row.role, row.project])),
  );
  return (
    <div className={a.projectModels}>
      {ROLE_MODELS.map((row) => (
        <ModelField
          key={row.role}
          label={row.role}
          inheritLabel={`Use Workspace default (${
            selectionLabel(row.workspace)
          })`}
          inherited={row.workspace}
          value={chosen[row.role]}
          onChange={(value) => setChosen({ ...chosen, [row.role]: value })}
          overrideNote="Overrides Workspace"
        />
      ))}
    </div>
  );
}

/** A7: project의 Agents 탭. */
export function AgentsBody({ open }: { open: Open }) {
  return (
    <div className={a.agentsPage}>
      <h1 className={styles.searchTitle}>Agents in phroner</h1>
      <div className={styles.cards}>
        {cards().map((card) => (
          <Card key={card.id}>
            <div className={styles.cardHead}>
              <h3 className={a.cardTitle}>
                <ProfileAvatar profile={profileOf(card.name)} size="md" />
                {card.name}
              </h3>
              <span className={styles.chip}>{card.kind}</span>
            </div>
            {card.text === undefined
              ? null
              : <p className={styles.purpose}>{card.text}</p>}
            <ul className={styles.rows}>
              <li>{card.model}</li>
              <li>{card.counts}</li>
            </ul>
            <div className={styles.actions}>
              <Button onClick={() => open(operatorTab(card.id))}>Open</Button>
            </div>
          </Card>
        ))}
      </div>
      <div className={styles.newContext}>
        <Button
          variant="primary"
          icon={lophnSpaceIcons.add}
          onClick={() => open(operatorTab("new"))}
        >
          New Operator
        </Button>
      </div>
      <section className={a.section}>
        <div className={a.sectionHead}>
          <h2 className={styles.sectionTitle}>Instructions</h2>
          <Button size="sm">Edit</Button>
        </div>
        <p className={a.sectionLead}>
          LOPHN.md · Shared by every agent in phroner
        </p>
        <pre className={styles.code}>
          {LOPHN_MD_PREVIEW.split("\n").slice(0, 3).join("\n")}
        </pre>
        <p className={styles.note}>
          Your project's AGENTS.md is for coding agents; lophn agents read
          LOPHN.md.
        </p>
      </section>
      <section className={a.section}>
        <div className={a.sectionHead}>
          <h2 className={styles.sectionTitle}>Models for this project</h2>
        </div>
        <ProjectModels />
        <p className={styles.note}>
          Leave a row alone and it follows the Workspace default.
        </p>
      </section>
      <section className={a.section}>
        <div className={a.sectionHead}>
          <h2 className={styles.sectionTitle}>Skills</h2>
          <Button size="sm" icon={lophnSpaceIcons.add}>Add skill</Button>
        </div>
        <ToggleList items={PROJECT_SKILLS} />
      </section>
      <section className={a.section}>
        <div className={a.sectionHead}>
          <h2 className={styles.sectionTitle}>MCP servers</h2>
          <Button size="sm" icon={lophnSpaceIcons.add}>Add server</Button>
        </div>
        <ToggleList items={PROJECT_MCP} />
      </section>
      <p className={`${styles.note} ${a.stored}`}>
        Stored in lophn, not in your project folder.
      </p>
    </div>
  );
}

const PERMISSION_OPTIONS = [
  { value: "ask", label: "Ask first" },
  { value: "edits", label: "Allow document edits" },
];

const BUILT_IN_INSTRUCTIONS = {
  lophn:
    "You talk with the person about this project. You answer from its documents and contexts, and you ask before you change a document.",
  engineer:
    "You keep this project's contexts and searches in shape. You write contracts, check documents against them and explain what you find.",
} as const;

/** Profile 칸: avatar 미리보기, [Choose icon ▾]로 여는 icon grid, [Upload image…]. */
function ProfileField(
  { value, onChange }: {
    value: AgentProfile;
    onChange: (profile: AgentProfile) => void;
  },
) {
  const [grid, setGrid] = useState(true);
  return (
    <fieldset className={a.group}>
      <legend className={styles.legend}>Profile</legend>
      <div className={a.profileRow}>
        <ProfileAvatar profile={value} size="lg" label="Avatar preview" />
        <div className={a.profileTools}>
          <div className={a.profileButtons}>
            <Button
              size="sm"
              aria-expanded={grid}
              onClick={() => setGrid(!grid)}
            >
              Choose icon ▾
            </Button>
            <Button
              size="sm"
              onClick={() => onChange({ ...value, image: true })}
            >
              Upload image…
            </Button>
            {value.image
              ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onChange({ ...value, image: false })}
                >
                  Remove image
                </Button>
              )
              : null}
          </div>
          {grid
            ? (
              <div className={a.iconGrid} role="group" aria-label="Icons">
                {AVATAR_ICON_KEYS.map((key) => (
                  <button
                    key={key}
                    type="button"
                    className={a.iconCell}
                    aria-label={AVATAR_ICON_LABEL[key]}
                    aria-pressed={!value.image && value.icon === key}
                    onClick={() => onChange({ icon: key })}
                  >
                    <Icon icon={AVATAR_ICONS[key]} pixels={18} />
                  </button>
                ))}
              </div>
            )
            : null}
          <p className={styles.note}>
            An icon, or an image you upload. It shows next to the agent's
            messages.
          </p>
        </div>
      </div>
    </fieldset>
  );
}

/** Contexts 칸: 붙인 context chip과 [+ Add context ▾]. 0개도 된다. */
function ContextsField(
  { value, onChange }: {
    value: readonly string[];
    onChange: (value: readonly string[]) => void;
  },
) {
  const rest = PROJECT_CONTEXTS.filter((name) => !value.includes(name));
  return (
    <fieldset className={a.group}>
      <legend className={styles.legend}>Contexts</legend>
      {value.length === 0
        ? (
          <p className={styles.note}>
            No contexts. This operator works with project documents only.
          </p>
        )
        : (
          <div className={a.contextChips}>
            {value.map((name) => (
              <span key={name} className={a.contextChip}>
                {name}
                <button
                  type="button"
                  className={a.chipX}
                  aria-label={`Remove ${name}`}
                  onClick={() =>
                    onChange(value.filter((item) => item !== name))}
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}
      <div>
        <Menu
          trigger={
            <Button
              size="sm"
              icon={lophnSpaceIcons.add}
              disabled={rest.length === 0}
            >
              Add context ▾
            </Button>
          }
          items={rest.map((name) => ({ id: name, label: name }))}
          onSelect={(name) => onChange([...value, name])}
        />
      </div>
    </fieldset>
  );
}

/** A8: agent 하나의 편집 탭. 내장 agent는 이름이 고정이고 Contexts 칸이 없다. */
export function OperatorEditor(
  { id, onDone }: { id: string; onDone: () => void },
) {
  const builtIn = id === "lophn" || id === "engineer";
  const fresh = id === "new";
  const operator = operatorOf(id);
  const name = fresh
    ? ""
    : id === "lophn"
    ? "lophn"
    : id === "engineer"
    ? "Context Engineer"
    : operator?.name ?? "";
  const role = builtIn ? name : "Operators";
  const roleRow = roleModel(role);
  const inherited = effectiveRoleModel(role);
  const [profile, setProfile] = useState<AgentProfile>(
    fresh ? { icon: "roles" } : profileOf(name),
  );
  const [contexts, setContexts] = useState<readonly string[]>(
    operator?.contexts ?? [],
  );
  const [model, setModel] = useState<ModelSelection | null>(
    builtIn ? null : operator?.model ?? null,
  );
  const [showBuiltIn, setShowBuiltIn] = useState(false);
  const source = roleRow.project === null ? "Workspace" : "project";
  return (
    <div className={a.editorPage}>
      <div className={a.editorHead}>
        <h1 className={`${styles.searchTitle} ${a.editorTitle}`}>
          <ProfileAvatar profile={profile} size="md" />
          {fresh ? "New Operator" : name}
        </h1>
      </div>
      <form
        className={styles.form}
        onSubmit={(event) => event.preventDefault()}
      >
        <ProfileField value={profile} onChange={setProfile} />
        {builtIn
          ? (
            <fieldset className={a.group}>
              <legend className={styles.legend}>Name</legend>
              <p className={a.fixedName}>{name}</p>
              <p className={styles.note}>
                Built in. The name can't be changed.
              </p>
            </fieldset>
          )
          : (
            <Field label="Name">
              <Input defaultValue={name} />
            </Field>
          )}
        <fieldset className={a.group}>
          <legend className={styles.legend}>Instructions</legend>
          <div className={a.projectInstr}>
            <div className={a.projectInstrHead}>
              <span>
                Project instructions · LOPHN.md — shared by every agent in
                phroner
              </span>
              <Button size="sm">Edit LOPHN.md</Button>
            </div>
            <pre className={a.projectInstrBody}>{LOPHN_MD_PREVIEW}</pre>
          </div>
          {builtIn
            ? (
              <div className={a.builtInInstr}>
                <button
                  type="button"
                  className={a.disclosure}
                  aria-expanded={showBuiltIn}
                  onClick={() => setShowBuiltIn(!showBuiltIn)}
                >
                  <Icon
                    icon={showBuiltIn
                      ? lophnSpaceIcons.collapse
                      : lophnSpaceIcons.expand}
                    pixels={iconPixels("small")}
                  />
                  Built-in instructions (read only)
                </button>
                {showBuiltIn
                  ? (
                    <p className={a.builtInText}>
                      {BUILT_IN_INSTRUCTIONS[id as "lophn" | "engineer"]}
                    </p>
                  )
                  : null}
              </div>
            )
            : null}
          <Field
            label={builtIn
              ? "Your instructions for this agent"
              : "Instructions for this agent"}
            help="The agent reads project instructions first, then these."
          >
            <Textarea
              rows={8}
              defaultValue={operator?.instructions ?? ""}
            />
          </Field>
        </fieldset>
        <ModelField
          label="Model"
          inheritLabel={`Use project default — ${
            selectionLabel(inherited)
          } (from ${source})`}
          inherited={inherited}
          value={model}
          onChange={setModel}
        />
        {builtIn
          ? null
          : <ContextsField value={contexts} onChange={setContexts} />}
        <fieldset className={a.group}>
          <legend className={styles.legend}>Skills</legend>
          <div className={a.checks}>
            {PROJECT_SKILLS.map((skill) => (
              <Checkbox
                key={skill.name}
                label={skill.name}
                defaultChecked={operator?.skills.includes(skill.name) ??
                  false}
              />
            ))}
          </div>
        </fieldset>
        <fieldset className={a.group}>
          <legend className={styles.legend}>MCP servers</legend>
          <div className={a.checks}>
            {PROJECT_MCP.map((server) => (
              <Checkbox
                key={server.name}
                label={server.name}
                defaultChecked={operator?.mcp.includes(server.name) ?? false}
              />
            ))}
          </div>
        </fieldset>
        <Field
          label="Permissions"
          help="Can't be wider than the project's permissions."
        >
          <Select options={PERMISSION_OPTIONS} defaultValue="ask" />
        </Field>
        <div className={styles.actions}>
          <Button variant="primary" onClick={onDone}>Save</Button>
          <Button onClick={onDone}>Cancel</Button>
        </div>
        <p className={styles.note}>
          Only the fields you change are saved; the rest follow project and
          Workspace defaults. Stored in lophn, not in your project folder.
        </p>
      </form>
    </div>
  );
}

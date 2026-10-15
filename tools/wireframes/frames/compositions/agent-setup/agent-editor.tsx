// agent 설정 화면. Project Manager, App Engineer, Operator, lophn이 같은 화면을 쓰고 새 Operator 만들기도 같다.
// Definition 탭에 profile·이름·놓을 곳·지침·model·skill·MCP가 있고 Grants 탭에서 맡길 것을 붙인다.
import { useState } from "react";
import {
  Button,
  Field,
  Input,
  Menu,
  Select,
  Tab,
  TabList,
  TabPanel,
  Tabs,
} from "@lophn/design/components";
import {
  lophnSpaceIcons,
} from "../../../../../packages/shell/renderer/icons/mod.ts";

import { ProfileAvatar } from "../agent-avatar.tsx";
import type { AgentProfile } from "../agents-data.ts";
import { type ModelSelection, selectionLabel } from "../model-options.ts";
import { ModelField } from "../model-picker.tsx";
import { GrantsPanel } from "./grants-panel.tsx";
import {
  InstructionsBlock,
  McpList,
  ProfileField,
  ServerForm,
  SkillList,
} from "./parts.tsx";
import {
  AGENT_LAYER_MCP,
  agentOf,
  type AgentSpec,
  APPS,
  GLOBAL_MODEL,
  LOPHN_MD_PREVIEW,
  MCP_SERVERS,
  PROJECT,
  PROJECT_CONTEXTS,
  PROJECT_MODEL,
  SKILLS,
  SOURCE_APP,
} from "./setup-data.ts";
import s from "./agent-setup.module.css";

export type EditorSection = "definition" | "grants";

export interface AgentEditorProps {
  /** agent id. 새 Operator는 "new". */
  readonly id: string;
  readonly onDone?: () => void;
  /** 처음에 보이는 탭. */
  readonly section?: EditorSection;
  /** MCP server 추가 form을 연 채 시작한다. */
  readonly serverForm?: boolean;
  /** Grants 탭에서 처음부터 펼쳐 둘 앱. */
  readonly openApp?: string;
}

type PlaceKind = "project" | "app";

/** 새 Operator를 놓을 곳 후보. project 하나와 앱들이다. */
const PLACES = [
  { value: `project:${PROJECT}`, label: `${PROJECT} (project)` },
  ...APPS.map((app) => ({
    value: `app:${app.app}`,
    label: `${app.app} (app)`,
  })),
];

const roleText = (agent: AgentSpec | undefined) =>
  agent === undefined ? "Operator" : agent.role;

/** model 칸이 따르는 위 층. project에 놓인 agent는 project 층을 거치고 나머지는 Workspace 기본을 바로 따른다. */
function inheritedModel(kind: PlaceKind | "none") {
  if (kind === "project" && PROJECT_MODEL !== null) {
    return { model: PROJECT_MODEL, source: "project" };
  }
  return { model: GLOBAL_MODEL, source: "Workspace" };
}

/** Contexts 칸: 붙은 context chip과 [+ Add context ▾]. 0개도 된다. project에 놓인 Operator만 갖는다. */
function ContextsField(
  { value, onChange }: {
    value: readonly string[];
    onChange: (value: readonly string[]) => void;
  },
) {
  const rest = PROJECT_CONTEXTS.filter((name) => !value.includes(name));
  return (
    <fieldset className={s.group}>
      <legend className={s.legend}>Contexts</legend>
      {value.length === 0
        ? (
          <p className={s.note}>
            No contexts. This Operator works with project documents only.
          </p>
        )
        : (
          <div className={s.chips}>
            {value.map((name) => (
              <span key={name} className={s.removable}>
                {name}
                <button
                  type="button"
                  className={s.chipX}
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
      <div className={s.rightEnd}>
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

function projectHeadOf(
  agent: AgentSpec | undefined,
  kind: PlaceKind | "none",
): string {
  if (agent?.role === "App Engineer") {
    return `Project instructions · LOPHN.md in ${PROJECT} — the project that holds ${SOURCE_APP}'s source`;
  }
  if (kind === "app") {
    return `Project instructions · LOPHN.md in ${PROJECT} — the project folder this Operator works in`;
  }
  return `Project instructions · LOPHN.md in ${PROJECT} — read by every agent placed there`;
}

export function AgentEditor(
  {
    id,
    onDone = () => {},
    section = "definition",
    serverForm = false,
    openApp,
  }: AgentEditorProps,
) {
  const fresh = id === "new";
  const agent = agentOf(id);
  const fixedRole = agent !== undefined && agent.role !== "Operator";
  const [tab, setTab] = useState<EditorSection>(section);
  const [profile, setProfile] = useState<AgentProfile>(
    agent?.profile ?? { icon: "roles" },
  );
  const [place, setPlace] = useState(`project:${PROJECT}`);
  const [instructions, setInstructions] = useState(agent?.instructions ?? "");
  const [contexts, setContexts] = useState<readonly string[]>(
    agent?.contexts ?? [],
  );
  const [model, setModel] = useState<ModelSelection | null>(
    agent?.model ?? null,
  );
  const [addServer, setAddServer] = useState(serverForm);

  const placeKind: PlaceKind | "none" = fresh
    ? (place.split(":")[0] as PlaceKind)
    : agent?.place.kind ?? "project";
  const placeName = fresh ? place.split(":")[1] : agent?.place.name ?? PROJECT;
  const inherited = inheritedModel(placeKind);
  // project 층은 project에 놓인 agent에만 있다.
  const layers = placeKind === "project"
    ? new Set(["Workspace", "Project"])
    : new Set(["Workspace"]);
  const skills = SKILLS.filter((item) => layers.has(item.layer));
  const own = AGENT_LAYER_MCP[id] ?? [];
  const servers = [
    ...MCP_SERVERS.filter((item) => layers.has(item.layer)),
    ...own,
  ];
  const mcpOn = [
    ...(agent?.mcpOn ?? []),
    ...own.filter((item) => item.on).map((item) => item.name),
  ];
  const title = fresh ? "New Operator" : agent?.name ?? "";

  const projectBlock = id === "lophn"
    ? undefined
    : projectHeadOf(agent, placeKind);

  return (
    <div className={s.formPage}>
      <h1 className={s.title}>
        <ProfileAvatar profile={profile} size="md" />
        {title}
        {fresh ? null : <span className={s.chip}>{roleText(agent)}</span>}
      </h1>
      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as EditorSection)}
      >
        <TabList>
          <Tab value="definition">Definition</Tab>
          <Tab value="grants" disabled={fresh}>Grants</Tab>
        </TabList>
        <TabPanel value="definition">
          <form
            className={s.form}
            onSubmit={(event) => event.preventDefault()}
          >
            <ProfileField value={profile} onChange={setProfile} />
            {fixedRole
              ? (
                <fieldset className={s.group}>
                  <legend className={s.legend}>Name</legend>
                  <p className={s.fixed}>{agent.name}</p>
                  <p className={s.note}>
                    {agent.role === "lophn"
                      ? "There is one lophn for everything. The name can't be changed."
                      : `Every ${
                        agent.role === "App Engineer" ? "app" : "project"
                      } has one ${agent.role}. The name can't be changed.`}
                  </p>
                </fieldset>
              )
              : (
                <Field label="Name">
                  <Input defaultValue={fresh ? "" : agent?.name} />
                </Field>
              )}
            {fresh
              ? (
                <>
                  <Field
                    label="Place"
                    help="Where this Operator works. Its sessions open in that place."
                  >
                    <Select
                      options={PLACES}
                      value={place}
                      onValueChange={setPlace}
                    />
                  </Field>
                  {placeKind === "app"
                    ? (
                      <Field
                        label="Project folder"
                        help={`The project folder this Operator reads and writes while it works on ${placeName}.`}
                      >
                        <Select
                          options={[{
                            value: PROJECT,
                            label: PROJECT,
                          }]}
                          defaultValue={PROJECT}
                        />
                      </Field>
                    )
                    : null}
                </>
              )
              : (
                <fieldset className={s.group}>
                  <legend className={s.legend}>Place</legend>
                  <p className={s.fixed}>
                    {agent?.place.kind === "none"
                      ? agent.place.name
                      : `${agent?.place.name} · ${agent?.place.kind}`}
                  </p>
                </fieldset>
              )}
            <InstructionsBlock
              projectHead={projectBlock}
              projectBody={LOPHN_MD_PREVIEW}
              projectNote={id === "lophn"
                ? "lophn takes no project's instructions. It reads a project's LOPHN.md when it works on that project."
                : undefined}
              agentValue={instructions}
              onAgentChange={setInstructions}
              help={id === "lophn"
                ? "Read after your Workspace instructions (Settings › Agents)."
                : "Read after the project instructions. Your Workspace instructions come before both."}
            />
            <ModelField
              label="Model"
              inheritLabel={`Use ${inherited.source} default — ${
                selectionLabel(inherited.model)
              }${inherited.source === "project" ? " (from project)" : ""}`}
              inherited={inherited.model}
              value={model}
              onChange={setModel}
              overrideNote={`Overrides ${inherited.source}`}
            />
            {placeKind === "project" && agent?.role !== "Project Manager" &&
                agent?.role !== "lophn"
              ? <ContextsField value={contexts} onChange={setContexts} />
              : null}
            <fieldset className={s.group}>
              <legend className={s.legend}>Skills</legend>
              <SkillList items={skills} offNames={agent?.skillsOff ?? []} />
              <p className={s.note}>
                The chip says which layer a skill comes from. A switch here
                changes only this agent.
              </p>
            </fieldset>
            <fieldset className={s.group}>
              <legend className={s.legend}>MCP servers</legend>
              <McpList items={servers} onNames={mcpOn} />
              {addServer
                ? (
                  <ServerForm
                    taken={servers.map((item) => item.name)}
                    onDone={() => setAddServer(false)}
                    scrollIntoView={serverForm}
                  />
                )
                : (
                  <div className={s.rightEnd}>
                    <Button
                      size="sm"
                      icon={lophnSpaceIcons.add}
                      onClick={() => setAddServer(true)}
                    >
                      Add server
                    </Button>
                  </div>
                )}
            </fieldset>
            <div className={s.formActions}>
              <Button onClick={onDone}>Cancel</Button>
              <Button variant="primary" onClick={onDone}>
                {fresh ? "Create Operator" : "Save"}
              </Button>
            </div>
            <p className={s.note}>
              {fresh
                ? "You can assign apps and tools in the Grants tab once the Operator exists. "
                : ""}
              Only the fields you change are saved; the rest follow the project
              and Workspace. Agent definitions are stored in lophn, not in your
              project folder.
            </p>
          </form>
        </TabPanel>
        <TabPanel value="grants">
          {agent === undefined ? null : (
            <>
              <GrantsPanel agent={agent} openApp={openApp} />
              <p className={`${s.note} ${s.stored}`}>
                Changes in Grants apply right away.
              </p>
            </>
          )}
        </TabPanel>
      </Tabs>
    </div>
  );
}

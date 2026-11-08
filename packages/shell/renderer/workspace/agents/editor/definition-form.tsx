// agent 설정의 Definition 탭. 위에서부터 Profile · Name · Description · Runtime · Input and output · Card · Instructions · Model · Tools(bare) · Skills · MCP servers · Shell extensions · Skip permissions.
// 정의 파일은 사람이 바꾼 칸만 가지므로 definition에 없는 칸은 상속이고, 상속하는 값은 detail이 준다.
// 저장 때 거절된 항목(issues)은 그 칸 안에 보인다.
import { type ReactNode, useState } from "react";
import { Button } from "@lophn/ui/primitives";
import { Checkbox, Field, Input, SegmentedControl } from "@lophn/ui/input";
import { t } from "@lophn/i18n";

import type { AgentDefinitionIssue } from "../../../../../protocol/lophn-agent/agent-definitions.ts";
import { extensionToolModelName } from "../../../../../protocol/extensions/manifest.ts";
import type { PublishedExtension } from "../../../../../protocol/lophn-agent/extension-tools.ts";
import type { McpServer } from "../../../../../protocol/lophn-agent/mcp-settings.ts";
import {
  type AgentWorkspace,
  isHarnessRuntime,
  type Modality,
} from "../../../../../protocol/lophn-agent/agent-values.ts";
import { LOPHN_AGENT_ID } from "../../../../../protocol/lophn-agent/workspaces.ts";
import { actionIcons } from "../../../icons/mod.ts";
import { Avatar } from "../../../parts/avatar/avatar.tsx";
import { CardFacts, modalityLabel, scopeLabel } from "../agent-card.tsx";
import type { AgentDetail, AgentDraft, ModelsView } from "../source.ts";
import type { McpLogin, McpRow } from "../views.ts";
import type { InstructionsPort } from "./instructions-editor.tsx";
import { ModelField, type ModelFieldSource } from "./model-field.tsx";
import {
  InstructionsBlock,
  McpList,
  ProfileField,
  SkillList,
} from "./parts.tsx";
import { ServerForm } from "./server-form.tsx";
import { ToolPicks } from "./tool-picks.tsx";
import styles from "./agent-editor.module.css";

type FieldName =
  | "profile"
  | "handle"
  | "workspace"
  | "name"
  | "description"
  | "runtime"
  | "modality"
  | "tools"
  | "instructions"
  | "model"
  | "skills"
  | "mcp"
  | "extensions"
  | "skip"
  | "card";

// 거절된 항목의 점 경로 첫 구간이 어느 칸에 속하는지. 칸에 없는 경로(frontmatter 등)는 맨 아래에 보인다.
const FIELD_OF: Readonly<Record<string, FieldName>> = {
  handle: "handle",
  workspace: "workspace",
  name: "name",
  profile: "profile",
  description: "description",
  runtime: "runtime",
  modality: "modality",
  tools: "tools",
  skills: "skills",
  body: "instructions",
  model: "model",
  skills_off: "skills",
  mcp_off: "mcp",
  mcp_servers: "mcp",
  extensions: "extensions",
  skip: "skip",
};

const fieldOf = (issue: AgentDefinitionIssue): FieldName | null =>
  FIELD_OF[issue.field.split(".")[0]] ?? null;

// `entries`가 있으면 `tools.2`처럼 목록 자리를 가리키는 issue에 그 이름을 붙인다.
function Issues({
  issues,
  entries,
}: {
  issues: readonly AgentDefinitionIssue[];
  entries?: readonly string[];
}) {
  return issues.map((issue) => {
    const entry = entries?.[Number(issue.field.split(".")[1])];
    return (
      <p
        key={`${issue.field}/${issue.code}`}
        className={styles.issue}
        data-issue={issue.code}
      >
        {entry === undefined ? "" : `${entry}: `}
        {t("project-workspace.notice.agent-editor-issue", {
          code: issue.code.replace(/_(\w)/g, (_, c: string) => c.toUpperCase()),
        })}
      </p>
    );
  });
}

function Group({
  name,
  heading,
  children,
}: {
  name: FieldName;
  heading: string;
  children: ReactNode;
}) {
  return (
    <fieldset className={styles.group} data-field={name}>
      <legend className={styles.legend}>{heading}</legend>
      {children}
    </fieldset>
  );
}

const ALL_MODALITIES: readonly Modality[] = ["text", "image", "file"];

// 셋 다 고른 쪽은 칸에서 뺀다: 파일에는 사람이 바꾼 칸만 둔다.
function withModality(
  definition: AgentDraft,
  side: "input" | "output",
  mode: Modality,
  on: boolean,
): AgentDraft["modality"] {
  const current = (side: "input" | "output") =>
    definition.modality?.[side] ?? ALL_MODALITIES;
  const chosen = ALL_MODALITIES.filter((one) =>
    one === mode ? on : current(side).includes(one),
  );
  const next = { ...definition.modality, [side]: chosen };
  const input = next.input ?? ALL_MODALITIES;
  const output = next.output ?? ALL_MODALITIES;
  const full = (list: readonly Modality[]) => list.length === 3;
  if (full(input) && full(output)) return undefined;
  return {
    ...(full(input) ? {} : { input }),
    ...(full(output) ? {} : { output }),
  };
}

function instructionsHead(detail: AgentDetail, workspaceName: string): string {
  const project =
    detail.instructions?.project ??
    (detail.workspace.kind === "project" ? workspaceName : null);
  return project === null
    ? t("agents.label.instructions-head-unknown")
    : t("agents.label.instructions-head-placed", { project });
}

// 비어 가는 칸은 정의에서 뺀다: 파일에는 사람이 바꾼 칸만 둔다.
function withField(
  definition: AgentDraft,
  key: Exclude<keyof AgentDraft, "body">,
  value: unknown,
): AgentDraft {
  const next: Record<string, unknown> = { ...definition };
  if (value === undefined || (Array.isArray(value) && value.length === 0)) {
    delete next[key];
  } else next[key] = value;
  return next as unknown as AgentDraft;
}

function ownServers(
  definition: AgentDraft,
  logins: Readonly<Record<string, McpLogin>>,
): McpRow[] {
  return (definition.mcp_servers ?? []).map((server) => {
    const login = logins[server.name];
    return {
      name: server.name,
      detail:
        server.transport === "stdio"
          ? server.stdio.executable
          : server.http.url,
      layer: "agent",
      on: server.enabled,
      status:
        login === undefined
          ? null
          : login.state === "signed_in"
            ? "connected"
            : "needs-sign-in",
      ...(login === undefined ? {} : { login }),
    };
  });
}

interface DefinitionFormProps {
  readonly detail: AgentDetail;
  readonly definition: AgentDraft;
  readonly issues: readonly AgentDefinitionIssue[];
  readonly models: ModelsView | null;
  /** Model 칸이 목록을 다시 읽는 통로. */
  readonly source: ModelFieldSource;
  /** agent가 놓인 곳의 이름(Agents 탭이 열린 project나 앱). */
  readonly workspaceName: string;
  readonly imageSrc: (image: string) => string;
  readonly onChange: (definition: AgentDraft) => void;
  readonly onUpload: (file: File) => void;
  /** OAuth MCP server의 [Sign in]. */
  readonly onSignIn: (row: McpRow) => void;
  /** 기다리는 로그인의 [Cancel]. */
  readonly onCancelSignIn: (row: McpRow) => void;
  /** 이 화면이 시작해 기다리는 server 이름. */
  readonly signingIn: readonly string[];
  /** project 지침(LOPHN.md)을 그 자리에서 고치는 길. */
  readonly projectInstructions: InstructionsPort;
  /** 설치되고 켜진 shell extension(core의 `extension_tools/catalog`). */
  readonly extensions: readonly PublishedExtension[];
}

export function DefinitionForm(props: DefinitionFormProps) {
  const { detail, definition, models, onChange } = props;
  const [addServer, setAddServer] = useState(false);
  const fresh = detail.assignment === null;
  const lophn = detail.assignment === LOPHN_AGENT_ID;
  // credential 이름이 쓰는 이 agent의 id. 새 agent는 저장 전에 미리 받은 id를 쓴다.
  const agentId = detail.assignment ?? detail.draftId;
  const issuesOf = (name: FieldName) =>
    props.issues.filter((issue) => fieldOf(issue) === name);
  const loose = props.issues.filter((issue) => fieldOf(issue) === null);

  const set = (key: Exclude<keyof AgentDraft, "body">, value: unknown) =>
    onChange(withField(definition, key, value));

  // 새 agent가 고를 수 있는 범위: 화면을 연 workspace. home이나 Settings는 없고 전역뿐이다.
  const here =
    detail.workspace.kind === "none"
      ? null
      : ({
          kind: detail.workspace.kind,
          id: detail.workspace.id,
        } as AgentWorkspace);
  const runtime = definition.runtime ?? "lophn";
  const bare = runtime === "bare";
  // harness(third-party CLI)는 자기 model·skill·MCP를 쓴다.
  const harness = isHarnessRuntime(runtime);
  // harness 값은 설정 `extensions.harness.enabled`가 켜졌을 때만 고르게 한다. 이미 harness인 agent는 꺼져 있어도 그 값을 보인다.
  const harnessOptions = (["claude-code", "codex", "opencode"] as const)
    .filter((one) => detail.harnessEnabled || one === runtime)
    .map((one) => ({
      value: one,
      label: t(`agents.label.runtime-${one}`),
    }));
  // lophn에서는 tools와 skills를 쓰지 못해(저장 거절) lophn으로 돌아가면 함께 지운다. 기본값이라 runtime 칸도 지운다.
  const setRuntime = (picked: string) => {
    const next: Record<string, unknown> = { ...definition };
    if (picked === "bare" || isHarnessRuntime(picked as never)) {
      next.runtime = picked;
      if (picked !== "bare") {
        delete next.tools;
        delete next.skills;
      }
    } else {
      delete next.runtime;
      delete next.tools;
      delete next.skills;
    }
    onChange(next as unknown as AgentDraft);
  };

  const skillsOff = definition.skills_off ?? [];
  // 정의의 skills_off는 이 agent가 끈 이름이다. 끄지 않은 skill은 보이는 대로 받는다.
  const toggleSkill = (name: string, on: boolean) =>
    set(
      "skills_off",
      on
        ? skillsOff.filter((one) => one !== name)
        : [...new Set([...skillsOff, name])],
    );
  // bare는 고른 skill만 받는다. 목록은 같고 켠 줄이 고른 것이다.
  const skillPicks = definition.skills ?? [];
  const togglePick = (name: string, on: boolean) =>
    set(
      "skills",
      on
        ? [...new Set([...skillPicks, name])]
        : skillPicks.filter((one) => one !== name),
    );
  const mcpOff = (definition.mcp_off ?? [])
    .filter((entry) => entry.original_tool === undefined)
    .map((entry) => entry.server_name);
  const own = ownServers(definition, detail.agentMcpLogins);

  // 할당한 id는 꺼졌거나 없어져도 목록에 남아야 사람이 뺄 수 있다.
  const catalog = props.extensions;
  const assigned = definition.extensions ?? [];
  const missing = assigned.filter(
    (id) => !catalog.some((one) => one.id === id),
  );
  const toggleExtension = (id: string, on: boolean) =>
    set(
      "extensions",
      on
        ? [...new Set([...assigned, id])]
        : assigned.filter((one) => one !== id),
    );
  // bare가 tools로 고를 수 있는 extension tool은 할당한 extension의 것이다.
  const extensionToolNames = catalog
    .filter((one) => assigned.includes(one.id))
    .flatMap((one) =>
      one.tools.map((tool) => extensionToolModelName(one.id, tool.name)),
    );

  // 위 층이 정한 값을 따를 때 보이는 따르기 선택지.
  const inherited = detail.inheritedModel;
  const layer = inherited?.source === "project" ? "project" : "global";
  const modelName = (choice: NonNullable<typeof inherited>["value"]) =>
    choice.model_name;
  const inheritLabel =
    inherited === null
      ? t("project-workspace.label.agent-editor-model-unset")
      : t("agents.label.model-inherit", {
          layer,
          model: modelName(inherited.value),
        });

  const profile = definition.profile ?? detail.effective.profile.value;
  const shownProfile =
    profile.kind === "character"
      ? profile
      : { kind: "image" as const, src: props.imageSrc(profile.image) };

  return (
    <form className={styles.form} onSubmit={(event) => event.preventDefault()}>
      {lophn ? (
        <Group
          name="profile"
          heading={t("project-workspace.heading.agent-editor-profile")}
        >
          <Avatar profile={shownProfile} size="lg" />
        </Group>
      ) : (
        <>
          <ProfileField
            value={profile}
            imageSrc={props.imageSrc}
            canUpload={!fresh}
            onChange={(profile) => set("profile", profile)}
            onUpload={props.onUpload}
          />
          <Issues issues={issuesOf("profile")} />
        </>
      )}

      <div data-field="name">
        <Field label={t("project-workspace.label.agent-editor-name")}>
          <Input
            value={definition.name ?? detail.effective.name.value}
            aria-invalid={issuesOf("name").length > 0 || undefined}
            onChange={(event) => set("name", event.currentTarget.value)}
          />
        </Field>
        <Issues issues={issuesOf("name")} />
      </div>

      {lophn ? (
        <p className={styles.note} data-fixed-handle="">
          {t("agents.notice.handle-fixed-lophn")}
        </p>
      ) : (
        <div data-field="handle">
          <Field
            label={t("agents.label.handle")}
            help={t("agents.notice.handle-help")}
          >
            <Input
              value={definition.handle ?? ""}
              readOnly={!fresh}
              aria-invalid={issuesOf("handle").length > 0 || undefined}
              onChange={(event) =>
                set(
                  "handle",
                  event.currentTarget.value === ""
                    ? undefined
                    : event.currentTarget.value,
                )
              }
            />
          </Field>
          <Issues issues={issuesOf("handle")} />
        </div>
      )}

      <div data-field="workspace">
        <Field
          label={t("agents.label.workspace")}
          help={t("agents.notice.workspace-help")}
        >
          {fresh && here !== null ? (
            <SegmentedControl
              size="sm"
              label={t("agents.label.workspace")}
              value={definition.workspace === undefined ? "global" : "here"}
              options={[
                {
                  value: "here",
                  label: scopeLabel(here, props.workspaceName),
                },
                { value: "global", label: scopeLabel(null, "") },
              ]}
              onValueChange={(picked) =>
                set("workspace", picked === "here" ? here : undefined)
              }
            />
          ) : (
            <Input
              value={scopeLabel(definition.workspace, props.workspaceName)}
              readOnly
            />
          )}
        </Field>
        <Issues issues={issuesOf("workspace")} />
      </div>

      {lophn ? null : (
        <>
          <div data-field="description">
            <Field
              label={t("agents.label.description")}
              help={t("agents.notice.description-help")}
            >
              <Input
                value={definition.description ?? ""}
                aria-invalid={issuesOf("description").length > 0 || undefined}
                onChange={(event) =>
                  set(
                    "description",
                    event.currentTarget.value === ""
                      ? undefined
                      : event.currentTarget.value,
                  )
                }
              />
            </Field>
            <Issues issues={issuesOf("description")} />
          </div>

          <Group name="runtime" heading={t("agents.heading.runtime")}>
            <SegmentedControl
              size="sm"
              label={t("agents.label.runtime")}
              value={runtime}
              options={[
                { value: "lophn", label: t("agents.label.runtime-lophn") },
                { value: "bare", label: t("agents.label.runtime-bare") },
                ...harnessOptions,
              ]}
              onValueChange={setRuntime}
            />
            <p className={styles.note}>{t("agents.notice.runtime-help")}</p>
            <Issues issues={issuesOf("runtime")} />
          </Group>
        </>
      )}

      <Group name="modality" heading={t("agents.heading.modality")}>
        {(["input", "output"] as const).map((side) => (
          <div key={side} className={styles.checks} data-modality={side}>
            <span className={styles.note}>
              {side === "input"
                ? t("agents.label.modality-input")
                : t("agents.label.modality-output")}
            </span>
            {ALL_MODALITIES.map((mode) => (
              <Checkbox
                key={mode}
                size="sm"
                label={modalityLabel(mode)}
                checked={(
                  definition.modality?.[side] ?? ALL_MODALITIES
                ).includes(mode)}
                onCheckedChange={(on) =>
                  set("modality", withModality(definition, side, mode, on))
                }
              />
            ))}
          </div>
        ))}
        <p className={styles.note}>{t("agents.notice.modality-help")}</p>
        <Issues issues={issuesOf("modality")} />
      </Group>

      {detail.card === undefined ? null : (
        <Group name="card" heading={t("agents.heading.card")}>
          <CardFacts card={detail.card} workspaceName={props.workspaceName} />
          <p className={styles.note}>{t("agents.notice.card-help")}</p>
        </Group>
      )}

      <InstructionsBlock
        project={detail.instructions}
        head={instructionsHead(detail, props.workspaceName)}
        port={props.projectInstructions}
        note={
          detail.workspace.kind === "app"
            ? t("agents.notice.app-no-project")
            : undefined
        }
        value={definition.body}
        help={
          detail.instructions === null
            ? t("agents.notice.instructions-help-lophn")
            : t("agents.notice.instructions-help")
        }
        issues={<Issues issues={issuesOf("instructions")} />}
        onChange={(body) => onChange({ ...definition, body })}
      />

      {harness ? null : (
        <div className={styles.group} data-field="model">
          <ModelField
            models={models}
            source={props.source}
            label={t("project-workspace.heading.agent-editor-model")}
            inheritLabel={inheritLabel}
            inherited={inherited?.value ?? null}
            value={definition.model ?? null}
            layer={
              definition.model === undefined
                ? (inherited?.source ?? null)
                : "agent"
            }
            overrideNote={t("agents.label.model-overrides", { layer })}
            onChange={(choice) => set("model", choice ?? undefined)}
          />
          <Issues issues={issuesOf("model")} />
        </div>
      )}

      {harness || !bare ? null : (
        <Group name="tools" heading={t("agents.heading.tools")}>
          <ToolPicks
            value={definition.tools ?? []}
            extensionTools={extensionToolNames}
            onChange={(tools) => set("tools", tools)}
          />
          <p className={styles.note}>{t("agents.notice.tools-help")}</p>
          <Issues issues={issuesOf("tools")} entries={definition.tools} />
        </Group>
      )}

      {harness ? null : (
        <Group
          name="skills"
          heading={t("project-workspace.heading.agent-editor-skills")}
        >
          <SkillList
            items={
              bare
                ? detail.skills.map((row) => ({ ...row, builtIn: false }))
                : detail.skills
            }
            offNames={
              bare
                ? detail.skills
                    .map((row) => row.name)
                    .filter((name) => !skillPicks.includes(name))
                : skillsOff
            }
            lockOff
            onToggle={bare ? togglePick : toggleSkill}
          />
          <p className={styles.note}>
            {t(
              bare
                ? "agents.notice.skills-bare-pick"
                : "agents.notice.skills-agent-only",
            )}
          </p>
          <Issues issues={issuesOf("skills")} />
        </Group>
      )}

      {harness ? null : (
        <Group
          name="mcp"
          heading={t("project-workspace.heading.agent-editor-mcp")}
        >
          <McpList
            items={[...detail.mcpServers, ...own]}
            offNames={mcpOff}
            lockOff
            onSignIn={props.onSignIn}
            onCancelSignIn={props.onCancelSignIn}
            signingIn={props.signingIn}
            onToggle={(name, on) => {
              if (own.some((row) => row.name === name)) {
                set(
                  "mcp_servers",
                  (definition.mcp_servers ?? []).map((server) =>
                    server.name === name ? { ...server, enabled: on } : server,
                  ),
                );
                return;
              }
              const rest = (definition.mcp_off ?? []).filter(
                (entry) =>
                  !(
                    entry.server_name === name &&
                    entry.original_tool === undefined
                  ),
              );
              set("mcp_off", on ? rest : [...rest, { server_name: name }]);
            }}
          />
          {agentId === null ? null : addServer ? (
            <ServerForm
              scope={agentId}
              oauth
              taken={[...detail.mcpServers, ...own].map((row) => row.name)}
              onCancel={() => setAddServer(false)}
              onAdd={(server: McpServer) => {
                set("mcp_servers", [...(definition.mcp_servers ?? []), server]);
                setAddServer(false);
              }}
            />
          ) : (
            <div className={styles.rightEnd}>
              <Button
                size="sm"
                icon={actionIcons.add}
                onClick={() => setAddServer(true)}
              >
                {t("settings.button.add-server")}
              </Button>
            </div>
          )}
          <Issues issues={issuesOf("mcp")} />
        </Group>
      )}

      {catalog.length === 0 && assigned.length === 0 ? null : (
        <Group name="extensions" heading={t("agents.heading.extensions")}>
          {catalog.map((one) => (
            <div key={one.id} data-extension={one.id}>
              <Checkbox
                size="sm"
                label={one.name}
                checked={assigned.includes(one.id)}
                onCheckedChange={(on) => toggleExtension(one.id, on)}
              />
              <p className={styles.note}>
                {[
                  one.description,
                  t("agents.label.extension-tools", {
                    count: one.tools.length,
                  }),
                ]
                  .filter((part) => part !== "")
                  .join(" · ")}
              </p>
            </div>
          ))}
          {missing.map((id) => (
            <div key={id} data-extension={id}>
              <Checkbox
                size="sm"
                label={id}
                checked
                onCheckedChange={() => toggleExtension(id, false)}
              />
              <p className={styles.note}>
                {t("agents.label.extension-unavailable")}
              </p>
            </div>
          ))}
          <p className={styles.note}>{t("agents.notice.extensions-help")}</p>
          <Issues issues={issuesOf("extensions")} />
        </Group>
      )}

      <Group name="skip" heading={t("agents.heading.skip")}>
        <Checkbox
          size="sm"
          label={t("agents.label.skip-start")}
          checked={definition.skip === true}
          onCheckedChange={(on) => set("skip", on ? true : undefined)}
        />
        <p className={styles.note}>{t("agents.notice.skip-help")}</p>
        <Issues issues={issuesOf("skip")} />
      </Group>

      <Issues issues={loose} />
    </form>
  );
}

// agent 설정의 Definition 탭. 위에서부터 Profile · Name · Place · Instructions · Model · Contexts · Skills · MCP servers.
// 정의 파일은 사람이 바꾼 칸만 가지므로 definition에 없는 칸은 상속이고, 상속하는 값은 detail이 준다.
// 저장 때 거절된 항목(issues)은 그 칸 안에 보인다.
import { type ReactNode, useState } from "react";
import { Button, IconButton } from "@lophn/ui/primitives";
import { Field, Input, Select } from "@lophn/ui/input";
import { Menu } from "@lophn/ui/overlay";
import { t } from "@lophn/wording";

import type { AgentDefinitionIssue } from "../../../../../protocol/lophn-agent/agent-definitions.ts";
import type { McpServer } from "../../../../../protocol/lophn-agent/mcp-settings.ts";
import { conversationIcons, commonIcons } from "../../../icons/mod.ts";
import type {
  AgentDetail,
  AgentDraft,
  ModelsView,
  PlaceChoice,
} from "../source.ts";
import type { McpRow } from "../views.ts";
import { ModelField } from "./model-field.tsx";
import {
  InstructionsBlock,
  McpList,
  ProfileField,
  SkillList,
} from "./parts.tsx";
import { ServerForm } from "./server-form.tsx";
import styles from "./agent-editor.module.css";

/** 붙일 수 있는 context 한 개(이 project의 context 목록). */
export interface ContextOption {
  readonly id: string;
  readonly name: string;
}

type FieldName =
  | "profile"
  | "name"
  | "place"
  | "instructions"
  | "model"
  | "contexts"
  | "skills"
  | "mcp";

// 거절된 항목의 점 경로 첫 구간이 어느 칸에 속하는지. 칸에 없는 경로(frontmatter 등)는 맨 아래에 보인다.
const FIELD_OF: Readonly<Record<string, FieldName>> = {
  name: "name",
  profile: "profile",
  body: "instructions",
  model: "model",
  contexts: "contexts",
  skills_off: "skills",
  mcp_off: "mcp",
  mcp_servers: "mcp",
};

const fieldOf = (issue: AgentDefinitionIssue): FieldName | null =>
  FIELD_OF[issue.field.split(".")[0]] ?? null;

function Issues({ issues }: { issues: readonly AgentDefinitionIssue[] }) {
  return issues.map((issue) => (
    <p
      key={`${issue.field}/${issue.code}`}
      className={styles.issue}
      data-issue={issue.code}
    >
      {t("project-workspace.notice.agent-editor-issue", {
        code: issue.code.replace(/_(\w)/g, (_, c: string) => c.toUpperCase()),
      })}
    </p>
  ));
}

function Group(
  { name, heading, children }: {
    name: FieldName;
    heading: string;
    children: ReactNode;
  },
) {
  return (
    <fieldset className={styles.group} data-field={name}>
      <legend className={styles.legend}>{heading}</legend>
      {children}
    </fieldset>
  );
}

/** Contexts 칸: 붙은 context chip과 [+ Add context ▾]. 0개도 된다. project에 놓인 Operator만 갖는다. */
function ContextsField(
  { value, options, onChange }: {
    value: readonly string[];
    options: readonly ContextOption[];
    onChange: (value: readonly string[]) => void;
  },
) {
  const nameOf = (id: string) =>
    options.find((item) => item.id === id)?.name ?? id;
  const rest = options.filter((item) => !value.includes(item.id));
  return (
    <>
      {value.length === 0
        ? (
          <p className={styles.note}>
            {t("project-workspace.empty.agent-editor-no-contexts")}
          </p>
        )
        : (
          <div className={styles.chips}>
            {value.map((id) => (
              <span key={id} className={styles.removable} data-context={id}>
                {nameOf(id)}
                <IconButton
                  icon={conversationIcons.removeContext}
                  size="sm"
                  label={t(
                    "project-workspace.label.agent-editor-remove-context",
                    { name: nameOf(id) },
                  )}
                  onClick={() =>
                    onChange(value.filter((one) =>
                      one !== id
                    ))}
                />
              </span>
            ))}
          </div>
        )}
      <div className={styles.rightEnd}>
        <Menu
          trigger={
            <Button
              size="sm"
              icon={commonIcons.add}
              disabled={rest.length === 0}
            >
              {t("project-workspace.button.agent-editor-add-context")}
            </Button>
          }
          items={rest.map((item) => ({ id: item.id, label: item.name }))}
          onSelect={(id) => onChange([...value, id])}
        />
      </div>
    </>
  );
}

const placeValue = (place: PlaceChoice) => `${place.kind}:${place.id}`;

function instructionsHead(detail: AgentDetail, placeName: string): string {
  const project = detail.instructions?.project ??
    (detail.place.kind === "project" ? placeName : null);
  if (project === null) return t("agents.label.instructions-head-unknown");
  if (detail.role === "app_engineer") {
    return t("agents.label.instructions-head-source", {
      project,
      app: detail.place.name,
    });
  }
  return detail.place.kind === "app"
    ? t("agents.label.instructions-head-folder", { project })
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

function ownServers(definition: AgentDraft): McpRow[] {
  return (definition.mcp_servers ?? []).map((server) => ({
    name: server.name,
    detail: server.transport === "stdio"
      ? server.stdio.executable
      : server.http.url,
    layer: "agent",
    on: server.enabled,
    status: null,
  }));
}

interface DefinitionFormProps {
  readonly detail: AgentDetail;
  readonly definition: AgentDraft;
  readonly issues: readonly AgentDefinitionIssue[];
  readonly models: ModelsView | null;
  /** agent가 놓인 곳의 이름(Agents 탭이 열린 project나 앱). */
  readonly placeName: string;
  readonly contexts: readonly ContextOption[];
  /** 새 Operator를 놓을 곳. */
  readonly place: string;
  readonly onPlace: (place: string) => void;
  readonly imageSrc: (image: string) => string;
  readonly onChange: (definition: AgentDraft) => void;
  readonly onUpload: (file: File) => void;
  readonly onEditProjectInstructions: () => void;
}

export function DefinitionForm(props: DefinitionFormProps) {
  const { detail, definition, models, onChange } = props;
  const [addServer, setAddServer] = useState(false);
  const fresh = detail.assignment === null;
  const builtIn = detail.kind === "built_in";
  const issuesOf = (name: FieldName) =>
    props.issues.filter((issue) => fieldOf(issue) === name);
  const loose = props.issues.filter((issue) => fieldOf(issue) === null);

  const placeKind = fresh
    ? (props.place.split(":")[0] as "project" | "app")
    : detail.place.kind;
  const withProject = detail.place.kind === "project" ||
    (fresh && placeKind === "project");
  const set = (
    key: Exclude<keyof AgentDraft, "body">,
    value: unknown,
  ) => onChange(withField(definition, key, value));

  const skillsOff = definition.skills_off ?? [];
  const mcpOff = (definition.mcp_off ?? []).filter((entry) =>
    entry.original_tool === undefined
  ).map((entry) => entry.server_name);
  const own = ownServers(definition);

  // 위 층이 정한 값을 따를 때 보이는 따르기 선택지.
  const inherited = detail.inheritedModel;
  const layer = inherited?.source === "project" ? "project" : "global";
  const modelName = (choice: NonNullable<typeof inherited>["value"]) =>
    choice.model_name;
  const inheritLabel = inherited === null
    ? t("project-workspace.label.agent-editor-model-unset")
    : t("agents.label.model-inherit", {
      layer,
      model: modelName(inherited.value),
    });

  const placeText = detail.place.kind === "none"
    ? t("agents.label.place-lophn")
    : t("agents.label.place-named", {
      name: detail.place.name,
      kind: detail.place.kind,
    });
  const fixedName = builtIn
    ? (detail.role === "lophn"
      ? t("agents.notice.name-fixed-lophn")
      : t("agents.notice.name-fixed-role", {
        owner: detail.role === "app_engineer" ? "app" : "project",
        role: detail.effective.name.value,
      }))
    : null;

  return (
    <form
      className={styles.form}
      onSubmit={(event) => event.preventDefault()}
    >
      {builtIn ? null : (
        <>
          <ProfileField
            value={definition.profile ?? detail.effective.profile.value}
            imageSrc={props.imageSrc}
            canUpload={!fresh}
            onChange={(profile) => set("profile", profile)}
            onUpload={props.onUpload}
          />
          <Issues issues={issuesOf("profile")} />
        </>
      )}

      {builtIn
        ? (
          <Group
            name="name"
            heading={t("project-workspace.label.agent-editor-name")}
          >
            <p className={styles.fixed} data-fixed-name="">
              {detail.effective.name.value}
            </p>
            <p className={styles.note}>{fixedName}</p>
          </Group>
        )
        : (
          <div data-field="name">
            <Field label={t("project-workspace.label.agent-editor-name")}>
              <Input
                value={definition.name ?? ""}
                aria-invalid={issuesOf("name").length > 0 || undefined}
                onChange={(event) => set("name", event.currentTarget.value)}
              />
            </Field>
            <Issues issues={issuesOf("name")} />
          </div>
        )}

      {fresh
        ? (
          <Field
            label={t("agents.label.place")}
            help={t("agents.notice.place-help")}
          >
            <Select
              options={detail.places.map((place) => ({
                value: placeValue(place),
                label: t("agents.label.place-choice", {
                  name: place.name,
                  kind: place.kind,
                }),
              }))}
              value={props.place}
              onValueChange={props.onPlace}
            />
          </Field>
        )
        : (
          <Group name="place" heading={t("agents.label.place")}>
            <p className={styles.fixed}>{placeText}</p>
          </Group>
        )}

      <InstructionsBlock
        project={detail.instructions}
        head={instructionsHead(detail, props.placeName)}
        note={detail.role === "lophn"
          ? t("agents.notice.lophn-no-project")
          : undefined}
        value={definition.body}
        help={detail.role === "lophn"
          ? t("agents.notice.instructions-help-lophn")
          : t("agents.notice.instructions-help")}
        issues={<Issues issues={issuesOf("instructions")} />}
        onChange={(body) => onChange({ ...definition, body })}
        onEditProject={props.onEditProjectInstructions}
      />

      <div className={styles.group} data-field="model">
        <ModelField
          models={models}
          label={t("project-workspace.heading.agent-editor-model")}
          inheritLabel={inheritLabel}
          inherited={inherited?.value ?? null}
          value={definition.model ?? null}
          overrideNote={t("agents.label.model-overrides", { layer })}
          onChange={(choice) => set("model", choice ?? undefined)}
        />
        <Issues issues={issuesOf("model")} />
      </div>

      {detail.role === "operator" && withProject
        ? (
          <Group
            name="contexts"
            heading={t("project-workspace.heading.agent-editor-contexts")}
          >
            <ContextsField
              value={definition.contexts ?? []}
              options={props.contexts}
              onChange={(value) => onChange({ ...definition, contexts: value })}
            />
            <Issues issues={issuesOf("contexts")} />
          </Group>
        )
        : null}

      <Group
        name="skills"
        heading={t("project-workspace.heading.agent-editor-skills")}
      >
        <SkillList
          items={detail.skills}
          offNames={skillsOff}
          lockOff
          onToggle={(name, on) =>
            set(
              "skills_off",
              on
                ? skillsOff.filter((one) => one !== name)
                : [...skillsOff.filter((one) => one !== name), name],
            )}
        />
        <p className={styles.note}>{t("agents.notice.skills-agent-only")}</p>
        <Issues issues={issuesOf("skills")} />
      </Group>

      <Group
        name="mcp"
        heading={t("project-workspace.heading.agent-editor-mcp")}
      >
        <McpList
          items={[...detail.mcpServers, ...own]}
          offNames={mcpOff}
          lockOff
          onToggle={(name, on) => {
            if (own.some((row) => row.name === name)) {
              set(
                "mcp_servers",
                (definition.mcp_servers ?? []).map((server) =>
                  server.name === name ? { ...server, enabled: on } : server
                ),
              );
              return;
            }
            const rest = (definition.mcp_off ?? []).filter((entry) =>
              !(entry.server_name === name && entry.original_tool === undefined)
            );
            set("mcp_off", on ? rest : [...rest, { server_name: name }]);
          }}
        />
        {addServer
          ? (
            <ServerForm
              scope={detail.place.kind === "project" && detail.place.id !== null
                ? detail.place.id
                : "global"}
              taken={[...detail.mcpServers, ...own].map((row) => row.name)}
              onCancel={() => setAddServer(false)}
              onAdd={(server: McpServer) => {
                set("mcp_servers", [...(definition.mcp_servers ?? []), server]);
                setAddServer(false);
              }}
            />
          )
          : (
            <div className={styles.rightEnd}>
              <Button
                size="sm"
                icon={commonIcons.add}
                onClick={() => setAddServer(true)}
              >
                {t("settings.button.add-server")}
              </Button>
            </div>
          )}
        <Issues issues={issuesOf("mcp")} />
      </Group>

      <Issues issues={loose} />
    </form>
  );
}

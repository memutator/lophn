// agent 설정의 Definition 탭. 위에서부터 Profile · Name · Place · Instructions · Model · Skills · MCP servers.
// 정의 파일은 사람이 바꾼 칸만 가지므로 definition에 없는 칸은 상속이고, 상속하는 값은 detail이 준다.
// 저장 때 거절된 항목(issues)은 그 칸 안에 보인다.
import { type ReactNode, useState } from "react";
import { Button } from "@lophn/ui/primitives";
import { Field, Input, Select } from "@lophn/ui/input";
import { t } from "@lophn/wording";

import type { AgentDefinitionIssue } from "../../../../../protocol/lophn-agent/agent-definitions.ts";
import type { McpServer } from "../../../../../protocol/lophn-agent/mcp-settings.ts";
import { commonIcons } from "../../../icons/mod.ts";
import type { AgentDetail, AgentDraft, ModelsView } from "../source.ts";
import type { McpRow } from "../views.ts";
import { ModelField, type ModelFieldSource } from "./model-field.tsx";
import {
  InstructionsBlock,
  McpList,
  ProfileField,
  SkillList,
} from "./parts.tsx";
import { ServerForm } from "./server-form.tsx";
import styles from "./agent-editor.module.css";

type FieldName =
  | "profile"
  | "name"
  | "place"
  | "instructions"
  | "model"
  | "skills"
  | "mcp";

// 거절된 항목의 점 경로 첫 구간이 어느 칸에 속하는지. 칸에 없는 경로(frontmatter 등)는 맨 아래에 보인다.
const FIELD_OF: Readonly<Record<string, FieldName>> = {
  name: "name",
  profile: "profile",
  body: "instructions",
  model: "model",
  skills: "skills",
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

function instructionsHead(detail: AgentDetail, placeName: string): string {
  const project = detail.instructions?.project ??
    (detail.place.kind === "project" ? placeName : null);
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
  /** Model 칸이 목록을 다시 읽는 통로. */
  readonly source: ModelFieldSource;
  /** agent가 놓인 곳의 이름(Agents 탭이 열린 project). */
  readonly placeName: string;
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
  // credential 이름이 쓰는 이 Operator의 id. 내장 role은 정의에 server를 두지 않아 없다.
  const operatorId = detail.assignment ?? detail.draftId;
  const issuesOf = (name: FieldName) =>
    props.issues.filter((issue) => fieldOf(issue) === name);
  const loose = props.issues.filter((issue) => fieldOf(issue) === null);

  const set = (
    key: Exclude<keyof AgentDraft, "body">,
    value: unknown,
  ) => onChange(withField(definition, key, value));

  // 정의의 skills는 받을 이름이고 비면 보이는 skill을 모두 받는다. 화면은 받지 않는 줄을 꺼진 줄로 그린다.
  const picked = definition.skills ?? [];
  const received = detail.skills.filter((row) => !row.builtIn && row.on).map((
    row,
  ) => row.name);
  const skillsOff = picked.length === 0
    ? []
    : received.filter((name) => !picked.includes(name));
  const toggleSkill = (name: string, on: boolean) => {
    const base = picked.length === 0 ? received : picked;
    const next = on
      ? [...new Set([...base, name])]
      : base.filter((one) => one !== name);
    set("skills", received.every((one) => next.includes(one)) ? [] : next);
  };
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
    });
  const fixedName = builtIn
    ? (detail.role === "lophn"
      ? t("agents.notice.name-fixed-lophn")
      : t("agents.notice.name-fixed-role", {
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
                value: place.id,
                label: place.name,
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
          source={props.source}
          label={t("project-workspace.heading.agent-editor-model")}
          inheritLabel={inheritLabel}
          inherited={inherited?.value ?? null}
          value={definition.model ?? null}
          layer={definition.model === undefined
            ? inherited?.source ?? null
            : "agent"}
          overrideNote={t("agents.label.model-overrides", { layer })}
          onChange={(choice) => set("model", choice ?? undefined)}
        />
        <Issues issues={issuesOf("model")} />
      </div>

      <Group
        name="skills"
        heading={t("project-workspace.heading.agent-editor-skills")}
      >
        <SkillList
          items={detail.skills}
          offNames={skillsOff}
          lockOff
          onToggle={toggleSkill}
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
        {builtIn || operatorId === null ? null : addServer
          ? (
            <ServerForm
              scope={operatorId}
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

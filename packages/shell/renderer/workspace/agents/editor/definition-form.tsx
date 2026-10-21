// agent 설정의 Definition 탭. 위에서부터 Profile · Name · Place · Instructions · Model · Domains(Operator) · Skills · MCP servers · Skip permissions(Operator).
// 정의 파일은 사람이 바꾼 칸만 가지므로 definition에 없는 칸은 상속이고, 상속하는 값은 detail이 준다.
// 저장 때 거절된 항목(issues)은 그 칸 안에 보인다.
import { type ReactNode, useState } from "react";
import { Button } from "@lophn/ui/primitives";
import { Checkbox, Field, Input, Select } from "@lophn/ui/input";
import { t } from "@lophn/wording";

import type { AgentDefinitionIssue } from "../../../../../protocol/lophn-agent/agent-definitions.ts";
import type { McpServer } from "../../../../../protocol/lophn-agent/mcp-settings.ts";
import { commonIcons } from "../../../icons/mod.ts";
import type { DomainView } from "../../source.ts";
import type {
  AgentDetail,
  AgentDraft,
  ModelsView,
  PlaceChoice,
} from "../source.ts";
import type { McpRow, SkillRow } from "../views.ts";
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
  | "domains"
  | "skills"
  | "mcp"
  | "skip";

// 거절된 항목의 점 경로 첫 구간이 어느 칸에 속하는지. 칸에 없는 경로(frontmatter 등)는 맨 아래에 보인다.
const FIELD_OF: Readonly<Record<string, FieldName>> = {
  name: "name",
  profile: "profile",
  body: "instructions",
  model: "model",
  skills: "skills",
  domains: "domains",
  mcp_off: "mcp",
  mcp_servers: "mcp",
  skip: "skip",
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

const placeValue = (place: PlaceChoice) => `${place.kind}:${place.id}`;

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
  /** agent가 놓인 곳의 이름(Agents 탭이 열린 project나 앱). */
  readonly placeName: string;
  /** 이 agent가 놓인(새 Operator면 고른) 곳 그릇의 active domain. 읽지 못했으면 null이다. */
  readonly domains: readonly DomainView[] | null;
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
  // domain을 바꿔 목록 밖이 된 skill 이름. 다음에 domain을 바꿀 때까지 알린다.
  const [dropped, setDropped] = useState<readonly string[]>([]);
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

  const picked = definition.skills ?? [];
  // Operator는 일할 domain을 고르고(비면 그릇의 전부), skill은 고른 domain의 것만 목록에 든다.
  // domain 없는 skill(전역)은 어느 domain을 골라도 든다.
  const placeIsApp = fresh
    ? props.place.startsWith("app:")
    : detail.place.kind === "app";
  const grouped = !builtIn && props.domains !== null;
  const containerDomains = props.domains ?? [];
  const containerIds = containerDomains.map((one) => one.id);
  const chosenIds = (definition.domains ?? []).filter((id) =>
    containerIds.includes(id)
  );
  const goneDomains = props.domains !== null &&
    (definition.domains ?? []).length > chosenIds.length;
  const activeIds = chosenIds.length === 0 ? containerIds : chosenIds;
  const visibleIn = (ids: readonly string[]) => (row: SkillRow) =>
    !grouped || row.domain === undefined || ids.includes(row.domain);
  const toggleDomain = (id: string, on: boolean) => {
    const next = containerIds.filter((one) =>
      one === id ? on : chosenIds.includes(one)
    );
    const nowVisible = detail.skills.filter(visibleIn(
      next.length === 0 ? containerIds : next,
    )).map((row) => row.name);
    const kept = picked.filter((name) => nowVisible.includes(name));
    setDropped(picked.filter((name) => !kept.includes(name)));
    onChange(withField(withField(definition, "domains", next), "skills", kept));
  };

  // 정의의 skills는 받을 이름이고 비면 보이는 skill을 모두 받는다. 화면은 받지 않는 줄을 꺼진 줄로 그린다.
  const received = detail.skills.filter((row) =>
    !row.builtIn && row.on && visibleIn(activeIds)(row)
  ).map((row) => row.name);
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
    : t(
      detail.place.kind === "app"
        ? "agents.label.place-named-app"
        : "agents.label.place-named",
      { name: detail.place.name },
    );
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
          : detail.place.kind === "app"
          ? t("agents.notice.app-no-project")
          : undefined}
        value={definition.body}
        help={detail.instructions === null
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

      {grouped && containerDomains.length > 0
        ? (
          <Group name="domains" heading={t("domain.heading.list")}>
            <div className={styles.checks}>
              {containerDomains.map((one) => (
                <Checkbox
                  key={one.id}
                  size="sm"
                  label={one.title}
                  checked={chosenIds.includes(one.id)}
                  onCheckedChange={(on) => toggleDomain(one.id, on)}
                />
              ))}
            </div>
            <p className={styles.note}>
              {chosenIds.length > 0 ? t("domain.notice.only-chosen") : t(
                placeIsApp
                  ? "domain.notice.all-of-app"
                  : "domain.notice.all-of-project",
              )}
            </p>
            {goneDomains
              ? <p className={styles.note}>{t("agents.notice.domains-gone")}</p>
              : null}
            <Issues issues={issuesOf("domains")} />
          </Group>
        )
        : null}

      <Group
        name="skills"
        heading={t("project-workspace.heading.agent-editor-skills")}
      >
        {grouped
          ? (
            <>
              <SkillList
                items={detail.skills.filter((row) => row.domain === undefined)}
                offNames={skillsOff}
                lockOff
                onToggle={toggleSkill}
              />
              {containerDomains.filter((one) => activeIds.includes(one.id))
                .map((one) => {
                  const rows = detail.skills.filter((row) =>
                    row.domain === one.id
                  );
                  return rows.length === 0 ? null : (
                    <div
                      key={one.id}
                      className={styles.skillGroup}
                      data-skill-domain={one.name}
                    >
                      <h3 className={styles.skillGroupTitle}>{one.title}</h3>
                      <SkillList
                        items={rows}
                        offNames={skillsOff}
                        lockOff
                        onToggle={toggleSkill}
                      />
                    </div>
                  );
                })}
            </>
          )
          : (
            <SkillList
              items={detail.skills}
              offNames={skillsOff}
              lockOff
              onToggle={toggleSkill}
            />
          )}
        <p className={styles.note}>{t("agents.notice.skills-agent-only")}</p>
        {dropped.length > 0
          ? (
            <p className={styles.note} data-skills-dropped="">
              {t("agents.notice.skills-dropped", { names: dropped.join(", ") })}
            </p>
          )
          : null}
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

      {detail.kind === "operator"
        ? (
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
        )
        : null}

      <Issues issues={loose} />
    </form>
  );
}

// agent 하나의 editor(shell/workspace#R38~R44). Agents 탭 안에서 [Open]이나 [+ New Operator]로 열리고, 위에서부터
// Profile · Name · Instructions · Model · Contexts · Skills · MCP servers · Permissions와 [Save]·[Cancel], Operator는
// 맨 아래에 [Delete Operator]가 있다. What it does·Schedule·Last run·남길 문서 칸은 없다. built-in(lophn·Context
// Engineer)의 [Open]도 이 editor다: Name은 고정 글자, Contexts 칸은 없고, Instructions에 "Built-in instructions
// (read only)" 접힌 줄이 더해지며, 지우는 길이 없다.
//
// 이 component는 form의 값(definition)을 props로 받아 그리고 바뀔 때마다 callback으로 알린다. 정의 파일은 사람이 바꾼 칸만
// 가지므로 definition에 없는 칸은 "상속"이고, effective가 그 칸의 실제 값과 출처를 준다(ReadAgent).
//
// 약속하는 DOM(test가 단언): 칸은 `[data-field=profile|name|instructions|model|contexts|skills|mcp|permissions]`가
// 위의 순서대로 나온다(built-in은 contexts 없이). 저장 때 거절된 항목(issues)은 그 칸 안에 `[data-issue=<code>]`로 보인다
// (`contexts.1`은 contexts 칸). Profile은 design `Avatar`(크기 lg) 미리보기, `[data-icon-option=<id>]` 단추(눌린 것은
// aria-pressed), `input[type=file]`(png·jpeg·webp)과 "Upload image" 단추를 둔다. Name은 input 하나이고 built-in은
// input 없이 글자 `[data-fixed-name]`다. Instructions는 `[data-project-instructions]` 읽기 전용 블록(머리 글,
// `[data-project-instructions-body]` 첫 4줄, "Edit LOPHN.md" 단추)이 textarea보다 위에 있다. Model은 상속일 때
// `[data-model-inherit]`("Use project default — <model> (from <출처>)")를, 고른 값이 있을 때 `[data-model-changed]`
// ("Changed")와 "Reset" 단추를 보이고 picker 단추 `[data-model-button]`는 항상 있다. Contexts의 chip은
// `[data-context=<id>]` 안에 ✕ 단추 하나를 가진다. Skills·MCP servers는 design `Switch`, Permissions는 design `Checkbox`
// (project가 허락하지 않은 동작은 disabled)다. 맨 아래 Delete 단추는 design `Dialog`로 확인을 한 번 받는다.
import {
  type ReactElement,
  type ReactNode,
  useId,
  useRef,
  useState,
} from "react";
import {
  Avatar,
  type AvatarProfile,
  Button,
  Checkbox,
  conversationIcons,
  Dialog,
  Field,
  Icon,
  IconButton,
  iconPixels,
  Input,
  lophnSpaceIcons,
  Menu,
  Switch,
  Textarea,
  workspaceIcons,
} from "@lophn/design/components";
import { t } from "@lophn/wording";

import type {
  AgentDefinition,
  AgentIssue,
  ValueSource,
} from "../../../../../protocol/lophn-agent/agent-values.ts";
import type { AgentRole } from "../../../../../protocol/lophn-agent/scope.ts";
import {
  ModelPicker,
  type ModelPickerProps,
} from "../../../conversation/model-picker/model-picker.tsx";
import type {
  AgentEffective,
  ModelLabel,
  ProjectInstructionsView,
} from "../views.ts";
export type { AgentEffective, Sourced } from "../views.ts";
import styles from "./agent-editor.module.css";

/** icon grid의 한 칸. id는 design의 avatar-icons 집합이고 label은 접근 이름이다. */
export interface AvatarIconOption {
  readonly id: string;
  readonly label: string;
}

/** 붙일 수 있는 context 한 개(이 project의 context 목록). */
export interface ContextOption {
  readonly id: string;
  readonly name: string;
}

/** Permissions 칸의 한 줄. projectAllows가 false인 동작은 project보다 넓어서 고를 수 없다. */
export interface PermissionChoice {
  readonly tool: string;
  readonly label: string;
  readonly projectAllows: boolean;
}

export interface AgentEditorProps {
  agent: {
    /** 첫 저장 전의 새 Operator는 null이다(이미지는 첫 저장 뒤에 올린다). */
    readonly assignment: string | null;
    readonly role: AgentRole;
    readonly kind: "built_in" | "operator";
  };
  projectName: string;
  /** form의 현재 값. 새 Operator는 `{ body: "" }`다. */
  definition: AgentDefinition;
  effective: AgentEffective;
  /** 저장이 거절된 항목별 이유(field는 점 경로). 없으면 빈 배열이다. */
  issues: readonly AgentIssue[];
  /** 올린 이미지 파일 이름(`avatar.png`)을 화면이 읽을 수 있는 주소로 푼다. */
  imageSrc: (image: string) => string;
  /** design의 avatar-icons 집합. 순서가 grid 순서다. */
  avatarIcons: readonly AvatarIconOption[];
  /** project의 LOPHN.md. editor는 첫 4줄을 읽기 전용으로 보인다. */
  projectInstructions: ProjectInstructionsView;
  /** built-in의 제품 지침 글. Operator는 null이다. */
  builtInInstructions: string | null;
  modelLabel: ModelLabel;
  /** model 단추와 picker. 고른 model이 가진 option 축만 picker가 보인다. */
  picker: ModelPickerProps;
  /** 이 project의 context 목록. built-in editor는 쓰지 않는다. */
  projectContexts: readonly ContextOption[];
  /** 이 project에서 쓸 수 있는 skill 이름. 정의의 skills_off에 든 것만 꺼져 보인다. */
  skills: readonly string[];
  /** 이 project에서 쓸 수 있는 MCP server 이름. 정의의 mcp_off에 서버 전체로 든 것만 꺼져 보인다. */
  mcpServers: readonly string[];
  /** 고를 수 있는 동작 전부. 켜짐은 definition.permissions, 없으면 effective.permissions다. */
  permissionChoices: readonly PermissionChoice[];
  onName: (name: string) => void;
  onPickIcon: (icon: string) => void;
  onUploadImage: (file: File) => void;
  /** 이 agent의 instructions 본문. */
  onInstructions: (body: string) => void;
  /** project instructions 블록의 [Edit LOPHN.md]. */
  onEditProjectInstructions: () => void;
  /** model 칸의 [Reset]. 정의에서 model을 빼고 상속으로 돌아간다. */
  onResetModel: () => void;
  onAddContext: (id: string) => void;
  onRemoveContext: (id: string) => void;
  onToggleSkill: (name: string, on: boolean) => void;
  onToggleMcp: (name: string, on: boolean) => void;
  onTogglePermission: (tool: string, on: boolean) => void;
  onSave: () => void;
  onCancel: () => void;
  /** 확인을 한 번 받은 뒤에만 부른다. */
  onDelete: () => void;
}

/** project instructions 블록이 보이는 줄 수(shell/workspace#R40). */
const PROJECT_LINES = 4;

type FieldName =
  | "profile"
  | "name"
  | "instructions"
  | "model"
  | "contexts"
  | "skills"
  | "mcp"
  | "permissions";

// 거절된 항목의 점 경로 첫 구간이 어느 칸에 속하는지. 칸에 없는 경로(frontmatter 등)는 맨 아래에 보인다.
const FIELD_OF: Readonly<Record<string, FieldName>> = {
  name: "name",
  profile: "profile",
  body: "instructions",
  model: "model",
  contexts: "contexts",
  skills_off: "skills",
  mcp_off: "mcp",
  safe_tools: "mcp",
  permissions: "permissions",
};

function fieldOf(issue: AgentIssue): FieldName | null {
  return FIELD_OF[issue.field.split(".")[0]] ?? null;
}

interface FieldProps extends AgentEditorProps {
  /** 이 칸에서 거절된 항목. */
  fieldIssues: readonly AgentIssue[];
}

function Issues({ issues }: { issues: readonly AgentIssue[] }) {
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

/** 제목이 있는 칸 하나와 이 칸에서 거절된 이유. */
function Section(
  { name, heading, issues, children }: {
    name: FieldName;
    heading: string;
    issues: readonly AgentIssue[];
    children: ReactNode;
  },
) {
  const id = useId();
  return (
    <section className={styles.section} data-field={name} aria-labelledby={id}>
      <h3 id={id} className={styles.heading}>{heading}</h3>
      {children}
      <Issues issues={issues} />
    </section>
  );
}

// 상속한 값의 출처를 wording의 select 값으로 옮긴다.
function sourceName(source: ValueSource): string {
  if (source.layer === "workspace") return "workspace";
  if (source.layer === "place") return source.place?.kind ?? "project";
  if (source.layer === "definition") return "agent";
  return "default";
}

function ProfileField(props: FieldProps) {
  const { definition, effective, avatarIcons } = props;
  const profile = definition.profile ?? effective.profile.value;
  const shown: AvatarProfile = profile.kind === "icon"
    ? { kind: "icon", icon: profile.icon }
    : { kind: "image", src: props.imageSrc(profile.image) };
  const saved = props.agent.assignment !== null;
  const file = useRef<HTMLInputElement>(null);
  return (
    <Section
      name="profile"
      heading={t("project-workspace.heading.agent-editor-profile")}
      issues={props.fieldIssues}
    >
      <div className={styles.profile}>
        <Avatar profile={shown} size="lg" />
        <div className={styles.profileBody}>
          <div
            className={styles.icons}
            role="group"
            aria-label={t("project-workspace.label.agent-editor-icons")}
          >
            {avatarIcons.map((option) => (
              <button
                key={option.id}
                type="button"
                className={styles.iconOption}
                data-icon-option={option.id}
                aria-label={option.label}
                aria-pressed={profile.kind === "icon" &&
                  profile.icon === option.id}
                onClick={() => props.onPickIcon(option.id)}
              >
                <Avatar profile={{ kind: "icon", icon: option.id }} size="sm" />
              </button>
            ))}
          </div>
          <div className={styles.upload}>
            <input
              ref={file}
              type="file"
              hidden
              accept="image/png,image/jpeg,image/webp"
              aria-label={t("project-workspace.label.agent-editor-image-file")}
              onChange={(event) => {
                const chosen = event.currentTarget.files?.[0];
                if (chosen) props.onUploadImage(chosen);
                // 같은 파일을 다시 골라도 change가 오도록 비운다.
                event.currentTarget.value = "";
              }}
            />
            <Button
              size="sm"
              icon={workspaceIcons.upload}
              disabled={!saved}
              onClick={() => file.current?.click()}
            >
              {t("project-workspace.button.agent-editor-upload-image")}
            </Button>
            {saved ? null : (
              <p className={styles.note}>
                {t("project-workspace.notice.agent-editor-save-first")}
              </p>
            )}
          </div>
        </div>
      </div>
    </Section>
  );
}

function NameField(props: FieldProps) {
  const { agent, definition, effective, fieldIssues } = props;
  const label = t("project-workspace.label.agent-editor-name");
  if (agent.kind === "built_in") {
    return (
      <Section name="name" heading={label} issues={fieldIssues}>
        <span className={styles.fixedName} data-fixed-name="">
          {effective.name.value}
        </span>
      </Section>
    );
  }
  return (
    <section className={styles.section} data-field="name">
      <Field label={label}>
        <Input
          value={definition.name ?? ""}
          aria-invalid={fieldIssues.length > 0 || undefined}
          onChange={(event) => props.onName(event.currentTarget.value)}
        />
      </Field>
      <Issues issues={fieldIssues} />
    </section>
  );
}

function InstructionsField(props: FieldProps) {
  const { projectInstructions, builtInInstructions, fieldIssues } = props;
  const [expanded, setExpanded] = useState(false);
  const builtInId = useId();
  const lines = projectInstructions.text.split("\n").slice(0, PROJECT_LINES)
    .join("\n");
  return (
    <section className={styles.section} data-field="instructions">
      <Field
        label={t("project-workspace.label.agent-editor-instructions")}
        help={t("project-workspace.notice.agent-editor-body-help")}
      >
        <div className={styles.project} data-project-instructions="">
          <p className={styles.projectHead}>
            {t("project-workspace.label.agent-editor-project-instructions", {
              project: props.projectName,
            })}
          </p>
          {projectInstructions.text.trim() === ""
            ? (
              <p className={styles.note}>
                {t(
                  "project-workspace.empty.agent-editor-no-project",
                )}
              </p>
            )
            : (
              <pre
                className={styles.projectBody}
                data-project-instructions-body=""
              >{lines}</pre>
            )}
          <div>
            <Button
              size="sm"
              variant="ghost"
              onClick={props.onEditProjectInstructions}
            >
              {t(
                "project-workspace.button.agent-editor-edit-project",
              )}
            </Button>
          </div>
        </div>
        {builtInInstructions === null ? null : (
          <div className={styles.builtIn}>
            <button
              type="button"
              className={styles.builtInToggle}
              aria-expanded={expanded}
              aria-controls={builtInId}
              onClick={() => setExpanded(!expanded)}
            >
              <Icon
                icon={expanded
                  ? lophnSpaceIcons.collapse
                  : lophnSpaceIcons.expand}
                pixels={iconPixels("base")}
              />
              {t("project-workspace.label.agent-editor-built-in")}
            </button>
            {expanded
              ? (
                <pre
                  id={builtInId}
                  className={styles.projectBody}
                >{builtInInstructions}</pre>
              )
              : null}
          </div>
        )}
        <Textarea
          rows={8}
          value={props.definition.body}
          aria-invalid={fieldIssues.length > 0 || undefined}
          onChange={(event) => props.onInstructions(event.currentTarget.value)}
        />
      </Field>
      <Issues issues={fieldIssues} />
    </section>
  );
}

function ModelField(props: FieldProps) {
  const { definition, effective } = props;
  const inherited = effective.model;
  return (
    <Section
      name="model"
      heading={t("project-workspace.heading.agent-editor-model")}
      issues={props.fieldIssues}
    >
      <div className={styles.modelRow}>
        <ModelPicker {...props.picker} scope="definition" />
        {definition.model !== undefined
          ? (
            <>
              <span className={styles.changed} data-model-changed="">
                {t("project-workspace.label.agent-editor-model-changed")}
              </span>
              <Button size="sm" variant="ghost" onClick={props.onResetModel}>
                {t("project-workspace.button.agent-editor-reset-model")}
              </Button>
            </>
          )
          : (
            <span className={styles.inherit} data-model-inherit="">
              {inherited === null
                ? t("project-workspace.label.agent-editor-model-unset")
                : t("project-workspace.label.agent-editor-model-inherit", {
                  model: props.modelLabel(inherited.value),
                  source: t("project-workspace.label.agent-editor-source", {
                    layer: sourceName(inherited.source),
                  }),
                })}
            </span>
          )}
      </div>
      <p className={styles.note}>
        {t("project-workspace.notice.agent-editor-model-help")}
      </p>
    </Section>
  );
}

function ContextsField(props: FieldProps) {
  const { definition, projectContexts } = props;
  const attached = definition.contexts ?? [];
  const nameOf = (id: string) =>
    projectContexts.find((item) => item.id === id)?.name ?? id;
  const free = projectContexts.filter((item) => !attached.includes(item.id));
  return (
    <Section
      name="contexts"
      heading={t("project-workspace.heading.agent-editor-contexts")}
      issues={props.fieldIssues}
    >
      {attached.length === 0
        ? (
          <p className={styles.note}>
            {t("project-workspace.empty.agent-editor-no-contexts")}
          </p>
        )
        : (
          <div className={styles.chips}>
            {attached.map((id) => (
              <span key={id} className={styles.chip} data-context={id}>
                {nameOf(id)}
                <IconButton
                  icon={conversationIcons.removeContext}
                  size="sm"
                  label={t(
                    "project-workspace.label.agent-editor-remove-context",
                    { name: nameOf(id) },
                  )}
                  onClick={() =>
                    props.onRemoveContext(id)}
                />
              </span>
            ))}
          </div>
        )}
      <div>
        <Menu
          trigger={
            <Button
              size="sm"
              icon={conversationIcons.attach}
              disabled={free.length === 0}
            >
              {t("project-workspace.button.agent-editor-add-context")}
            </Button>
          }
          items={free.map((item) => ({ id: item.id, label: item.name }))}
          onSelect={props.onAddContext}
        />
      </div>
    </Section>
  );
}

function SkillsField(props: FieldProps) {
  const off = props.definition.skills_off ?? [];
  return (
    <Section
      name="skills"
      heading={t("project-workspace.heading.agent-editor-skills")}
      issues={props.fieldIssues}
    >
      {props.skills.length === 0
        ? (
          <p className={styles.note}>
            {t("project-workspace.empty.agent-editor-no-skills")}
          </p>
        )
        : (
          <div className={styles.rows}>
            {props.skills.map((name) => (
              <Switch
                key={name}
                label={name}
                checked={!off.includes(name)}
                onCheckedChange={(on) => props.onToggleSkill(name, on)}
              />
            ))}
          </div>
        )}
    </Section>
  );
}

function McpField(props: FieldProps) {
  // 서버 전체를 끈 것만 꺼져 보인다. tool 하나만 끈 항목(original_tool이 있는 것)은 서버를 켠 채로 둔다.
  const off = (props.definition.mcp_off ?? [])
    .filter((entry) => entry.original_tool === undefined)
    .map((entry) => entry.server_name);
  return (
    <Section
      name="mcp"
      heading={t("project-workspace.heading.agent-editor-mcp")}
      issues={props.fieldIssues}
    >
      {props.mcpServers.length === 0
        ? (
          <p className={styles.note}>
            {t("project-workspace.empty.agent-editor-no-mcp")}
          </p>
        )
        : (
          <div className={styles.rows}>
            {props.mcpServers.map((name) => (
              <Switch
                key={name}
                label={name}
                checked={!off.includes(name)}
                onCheckedChange={(on) => props.onToggleMcp(name, on)}
              />
            ))}
          </div>
        )}
    </Section>
  );
}

function PermissionsField(props: FieldProps) {
  const { tools } = props.definition.permissions ??
    props.effective.permissions.value;
  return (
    <Section
      name="permissions"
      heading={t("project-workspace.heading.agent-editor-permissions")}
      issues={props.fieldIssues}
    >
      <p className={styles.note}>
        {t("project-workspace.notice.agent-editor-wider-help")}
      </p>
      <div className={styles.rows}>
        {props.permissionChoices.map((choice) => {
          const on = tools.includes(choice.tool);
          return (
            <Checkbox
              key={choice.tool}
              label={choice.label}
              checked={on}
              // project보다 넓은 동작은 새로 고를 수 없다. 이미 든 것은 뺄 수 있다.
              disabled={!choice.projectAllows && !on}
              onCheckedChange={(next) =>
                props.onTogglePermission(choice.tool, next)}
            />
          );
        })}
      </div>
    </Section>
  );
}

// 지우기는 확인을 한 번 받은 뒤에만 부른다(R38). 저장은 확인이 없다.
function DeleteOperator(props: AgentEditorProps) {
  const [asking, setAsking] = useState(false);
  const name = props.definition.name ?? props.effective.name.value;
  return (
    <div className={styles.danger}>
      <Button
        variant="danger"
        icon={workspaceIcons.trash}
        onClick={() => setAsking(true)}
      >
        {t("project-workspace.button.agent-editor-delete")}
      </Button>
      <Dialog
        open={asking}
        onOpenChange={setAsking}
        title={t("project-workspace.heading.agent-editor-delete-title", {
          name,
        })}
        actions={
          <>
            <Button onClick={() => setAsking(false)}>
              {t("common.button.cancel")}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setAsking(false);
                props.onDelete();
              }}
            >
              {t("project-workspace.button.agent-editor-delete-confirm")}
            </Button>
          </>
        }
      >
        <p>{t("project-workspace.notice.agent-editor-delete-body")}</p>
      </Dialog>
    </div>
  );
}

export function AgentEditor(props: AgentEditorProps): ReactElement {
  const { agent } = props;
  const issuesOf = (name: FieldName) =>
    props.issues.filter((issue) => fieldOf(issue) === name);
  const loose = props.issues.filter((issue) => fieldOf(issue) === null);
  return (
    <div className={styles.editor}>
      <ProfileField {...props} fieldIssues={issuesOf("profile")} />
      <NameField {...props} fieldIssues={issuesOf("name")} />
      <InstructionsField {...props} fieldIssues={issuesOf("instructions")} />
      <ModelField {...props} fieldIssues={issuesOf("model")} />
      {agent.kind === "operator"
        ? <ContextsField {...props} fieldIssues={issuesOf("contexts")} />
        : null}
      <SkillsField {...props} fieldIssues={issuesOf("skills")} />
      <McpField {...props} fieldIssues={issuesOf("mcp")} />
      <PermissionsField {...props} fieldIssues={issuesOf("permissions")} />
      <Issues issues={loose} />
      <div className={styles.actions}>
        <Button variant="primary" onClick={props.onSave}>
          {t("project-workspace.button.agent-editor-save")}
        </Button>
        <Button onClick={props.onCancel}>{t("common.button.cancel")}</Button>
      </div>
      {agent.kind === "operator" && agent.assignment !== null
        ? <DeleteOperator {...props} />
        : null}
    </div>
  );
}

// agent 설정 화면들이 같이 쓰는 조각: 층이 붙은 skill·MCP 목록, profile 칸, 지침 블록, 보호 입력 안내.
// 토글은 줄 오른쪽 끝 고정 열에 있고, 이름은 줄 왼쪽에 따로 있어서 Switch의 라벨은 눈에는 숨긴다.
import { type ReactNode, useRef, useState } from "react";
import { Avatar, type AvatarProfile } from "../../../parts/avatar/avatar.tsx";
import { Button, Field, Switch, Textarea } from "@lophn/design/components";
import { t } from "@lophn/wording";
import type { MessageKey } from "@lophn/wording";

import type { Profile } from "../../../../../protocol/lophn-agent/agent-values.ts";
import type { Role } from "../../../../../protocol/lophn-agent/places.ts";
import {
  AVATAR_ICON_IDS,
  type AvatarIconId,
} from "../../../parts/avatar/avatar-icons.ts";
import { workspaceIcons } from "../../../icons/mod.ts";
import type {
  McpLayer,
  McpRow,
  McpStatus,
  ProjectInstructionsView,
  SkillLayer,
  SkillRow,
} from "../views.ts";
import styles from "./agent-editor.module.css";

const LAYER_LABEL: Record<SkillLayer | McpLayer, MessageKey> = {
  builtin: "agents.label.layer-builtin",
  global: "agents.label.layer-global",
  project: "agents.label.layer-project",
  agent: "agents.label.layer-agent",
};

/** role 이름. 카드의 chip과 editor 제목 옆에 쓴다. */
export const ROLE_LABEL = {
  lophn: "project-workspace.label.role-lophn",
  project_manager: "agents.label.role-project-manager",
  app_engineer: "project-workspace.label.role-app-engineer",
  operator: "project-workspace.label.agent-kind-operator",
} as const satisfies Record<Role, MessageKey>;

const STATUS_LABEL: Record<"off" | "connected" | "needs-sign-in", MessageKey> =
  {
    off: "settings.label.off",
    connected: "settings.label.status-connected",
    "needs-sign-in": "settings.label.status-needs-sign-in",
  };

/** 토글. 이름은 줄 왼쪽에 따로 있어서 Switch의 라벨은 눈에는 숨기고 읽기용으로만 둔다. */
function RowToggle(
  { label, checked, disabled, onChange }: {
    label: string;
    checked: boolean;
    disabled?: boolean;
    onChange: (on: boolean) => void;
  },
) {
  return (
    <span className={`${styles.toggleCell} ${styles.hiddenLabel}`}>
      <Switch
        label={label}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
      />
    </span>
  );
}

interface SkillListProps {
  readonly items: readonly SkillRow[];
  /** 보고 있는 층에서 꺼 둔 이름. 이 이름은 꺼진 것으로 그린다. */
  readonly offNames?: readonly string[];
  /** 위 층에서 이미 꺼진 줄은 이 층에서 켤 수 없다. agent 설정이 켠다. */
  readonly lockOff?: boolean;
  readonly showLayer?: boolean;
  readonly onToggle: (name: string, on: boolean) => void;
}

/** skill 목록. 줄마다 어느 층의 것인지 chip으로 보이고, 오른쪽 끝 토글은 보고 있는 층에서의 켬·끔이다. 내장 skill은 토글 대신 Built-in 표시다. */
export function SkillList(
  { items, offNames = [], lockOff = false, showLayer = true, onToggle }:
    SkillListProps,
) {
  return (
    <ul className={styles.toggleList}>
      {items.map((item) => (
        <li key={item.name} className={styles.toggleRow} data-skill={item.name}>
          <span className={styles.toggleMain}>
            <span className={styles.toggleName}>{item.name}</span>
            <span className={styles.toggleDetail}>{item.detail}</span>
          </span>
          {showLayer && !item.builtIn
            ? <span className={styles.chip}>{t(LAYER_LABEL[item.layer])}</span>
            : <span />}
          {item.builtIn
            ? (
              <span className={styles.toggleCell}>
                <span className={styles.chip} data-built-in="">
                  {t("agents.label.built-in")}
                </span>
              </span>
            )
            : (
              <RowToggle
                label={item.name}
                checked={item.on && !offNames.includes(item.name)}
                disabled={lockOff && !item.on}
                onChange={(on) => onToggle(item.name, on)}
              />
            )}
        </li>
      ))}
    </ul>
  );
}

function statusText(on: boolean, status: McpStatus): string {
  if (!on) return t(STATUS_LABEL.off);
  return status === null ? "" : t(STATUS_LABEL[status]);
}

interface McpListProps {
  readonly items: readonly McpRow[];
  /** 보고 있는 층에서 꺼 둔 이름. */
  readonly offNames?: readonly string[];
  readonly lockOff?: boolean;
  readonly showLayer?: boolean;
  readonly onToggle: (name: string, on: boolean) => void;
}

/** MCP server 목록. 이름 옆 점이 연결 상태다. */
export function McpList(
  { items, offNames = [], lockOff = false, showLayer = true, onToggle }:
    McpListProps,
) {
  return (
    <ul className={styles.toggleList}>
      {items.map((item) => {
        const on = item.on && !offNames.includes(item.name);
        const text = statusText(on, item.status);
        return (
          <li key={item.name} className={styles.toggleRow} data-mcp={item.name}>
            <span className={styles.toggleMain}>
              <span className={styles.toggleName}>
                <span
                  className={`${styles.dot} ${
                    on && item.status === "connected"
                      ? styles.dotConnected
                      : on && item.status === "needs-sign-in"
                      ? styles.dotNeedsSignIn
                      : ""
                  }`}
                  role="img"
                  aria-label={text}
                  title={text}
                />
                {item.name}
              </span>
              <span className={styles.toggleDetail}>
                {text === "" ? item.detail : `${item.detail} · ${text}`}
              </span>
            </span>
            {showLayer
              ? (
                <span className={styles.chip}>
                  {t(LAYER_LABEL[item.layer])}
                </span>
              )
              : <span />}
            <RowToggle
              label={item.name}
              checked={on}
              disabled={lockOff && !item.on}
              onChange={(next) =>
                onToggle(item.name, next)}
            />
          </li>
        );
      })}
    </ul>
  );
}

const ICON_LABEL: Record<AvatarIconId, MessageKey> = {
  dock: "project-workspace.label.avatar-icon-dock",
  roles: "project-workspace.label.avatar-icon-roles",
  contexts: "project-workspace.label.avatar-icon-contexts",
  documents: "project-workspace.label.avatar-icon-documents",
  apps: "project-workspace.label.avatar-icon-apps",
  search: "project-workspace.label.avatar-icon-search",
  series: "project-workspace.label.avatar-icon-series",
  bookmark: "project-workspace.label.avatar-icon-bookmark",
  terminal: "project-workspace.label.avatar-icon-terminal",
  read: "project-workspace.label.avatar-icon-read",
  edit: "project-workspace.label.avatar-icon-edit",
  compare: "project-workspace.label.avatar-icon-compare",
};

interface ProfileFieldProps {
  readonly value: Profile;
  /** 올린 이미지 파일 이름을 화면이 읽을 수 있는 주소로 푼다. */
  readonly imageSrc: (image: string) => string;
  /** 새 Operator는 저장하기 전에는 이미지를 올릴 수 없다. */
  readonly canUpload: boolean;
  readonly onChange: (profile: Profile) => void;
  readonly onUpload: (file: File) => void;
}

/** profile 칸: 미리보기, icon grid, 이미지 올리기. */
export function ProfileField(
  { value, imageSrc, canUpload, onChange, onUpload }: ProfileFieldProps,
) {
  const [grid, setGrid] = useState(true);
  const file = useRef<HTMLInputElement>(null);
  const shown: AvatarProfile = value.kind === "icon"
    ? { kind: "icon", icon: value.icon }
    : { kind: "image", src: imageSrc(value.image) };
  return (
    <fieldset className={styles.group} data-field="profile">
      <legend className={styles.legend}>
        {t("project-workspace.heading.agent-editor-profile")}
      </legend>
      <div className={styles.profileRow}>
        <Avatar
          profile={shown}
          size="lg"
          label={t("agents.label.avatar-preview")}
        />
        <div className={styles.profileTools}>
          <div className={styles.profileButtons}>
            <Button
              size="sm"
              aria-expanded={grid}
              onClick={() => setGrid(!grid)}
            >
              {t("agents.button.choose-icon")}
            </Button>
            <input
              ref={file}
              type="file"
              hidden
              accept="image/png,image/jpeg,image/webp"
              aria-label={t("project-workspace.label.agent-editor-image-file")}
              onChange={(event) => {
                const chosen = event.currentTarget.files?.[0];
                if (chosen) onUpload(chosen);
                // 같은 파일을 다시 골라도 change가 오도록 비운다.
                event.currentTarget.value = "";
              }}
            />
            <Button
              size="sm"
              icon={workspaceIcons.upload}
              disabled={!canUpload}
              onClick={() => file.current?.click()}
            >
              {t("project-workspace.button.agent-editor-upload-image")}
            </Button>
            {value.kind === "image"
              ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onChange({ kind: "icon", icon: "roles" })}
                >
                  {t("agents.button.remove-image")}
                </Button>
              )
              : null}
          </div>
          {grid
            ? (
              <div
                className={styles.iconGrid}
                role="group"
                aria-label={t("project-workspace.label.agent-editor-icons")}
              >
                {AVATAR_ICON_IDS.map((id) => (
                  <button
                    key={id}
                    type="button"
                    className={styles.iconCell}
                    data-icon-option={id}
                    aria-label={t(ICON_LABEL[id])}
                    aria-pressed={value.kind === "icon" && value.icon === id}
                    onClick={() => onChange({ kind: "icon", icon: id })}
                  >
                    <Avatar profile={{ kind: "icon", icon: id }} size="sm" />
                  </button>
                ))}
              </div>
            )
            : null}
          <p className={styles.note}>
            {canUpload
              ? t("agents.notice.profile-help")
              : t("project-workspace.notice.agent-editor-save-first")}
          </p>
        </div>
      </div>
    </fieldset>
  );
}

/** project 지침이 보이는 줄 수. */
const PROJECT_LINES = 4;

interface InstructionsBlockProps {
  /** project 지침. null이면 이 agent는 project 지침을 받지 않는다(lophn). */
  readonly project: ProjectInstructionsView | null;
  /** project 지침 머리 글. */
  readonly head: string;
  /** project 지침을 받지 않는 이유 같은 안내. */
  readonly note?: string;
  readonly value: string;
  readonly help: string;
  readonly issues?: ReactNode;
  readonly onChange: (value: string) => void;
  readonly onEditProject: () => void;
}

/** 지침 블록: project 지침(읽기)과 이 agent의 지침(고침)을 같이 보인다. */
export function InstructionsBlock(
  { project, head, note, value, help, issues, onChange, onEditProject }:
    InstructionsBlockProps,
) {
  return (
    <fieldset className={styles.group} data-field="instructions">
      <legend className={styles.legend}>
        {t("project-workspace.label.agent-editor-instructions")}
      </legend>
      {project === null
        ? null
        : (
          <div className={styles.projectInstr} data-project-instructions="">
            <div className={styles.projectInstrHead}>
              <span>{head}</span>
              <Button size="sm" onClick={onEditProject}>
                {t("project-workspace.button.agent-editor-edit-project")}
              </Button>
            </div>
            {project.text.trim() === ""
              ? (
                <p className={styles.projectInstrEmpty}>
                  {t("project-workspace.empty.agent-editor-no-project")}
                </p>
              )
              : (
                <pre className={styles.projectInstrBody}>
                {project.text.split("\n").slice(0, PROJECT_LINES).join("\n")}
                </pre>
              )}
          </div>
        )}
      {note === undefined ? null : <p className={styles.note}>{note}</p>}
      <Field
        label={t("agents.label.agent-instructions")}
        help={help}
      >
        <Textarea
          rows={7}
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
      </Field>
      {issues}
    </fieldset>
  );
}

/** 보호 입력으로 받는다는 안내. 값은 이 창에서 치지 않는다. */
export function ProtectedKeyNote(
  { title, text, action }: {
    title: string;
    text: string;
    action?: { label: string; onClick: () => void };
  },
) {
  return (
    <div className={styles.protected}>
      <span className={styles.protectedText}>
        <span className={styles.protectedTitle}>{title}</span>
        <span>{text}</span>
      </span>
      {action === undefined
        ? null
        : <Button size="sm" onClick={action.onClick}>{action.label}</Button>}
    </div>
  );
}

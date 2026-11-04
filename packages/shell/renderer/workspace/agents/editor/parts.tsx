// agent 설정 화면들이 같이 쓰는 조각: 층이 붙은 skill·MCP 목록, profile 칸, 지침 블록, 보호 입력 안내.
// 토글은 줄 오른쪽 끝 고정 열에 있고, 이름은 줄 왼쪽에 따로 있어서 Switch의 라벨은 눈에는 숨긴다.

import { Field, Switch, Textarea } from "@lophn/ui/input";
import { Button } from "@lophn/ui/primitives";
import type { MessageKey } from "@lophn/i18n";
import { t } from "@lophn/i18n";
import { type ReactNode, useRef, useState } from "react";
import {
  AGENT_CHARACTER_COLORS,
  AGENT_CHARACTER_SHAPES,
  type CharacterProfile,
  DEFAULT_AGENT_CHARACTER,
  type Profile,
} from "../../../../../protocol/lophn-agent/agent-values.ts";
import { actionIcons } from "../../../icons/mod.ts";
import { Avatar, type AvatarProfile } from "../../../parts/avatar/avatar.tsx";
import type {
  McpLayer,
  McpRow,
  McpStatus,
  ProjectInstructionsView,
  SkillLayer,
  SkillRow,
} from "../views.ts";
import styles from "./agent-editor.module.css";
import {
  InstructionsEditor,
  type InstructionsPort,
} from "./instructions-editor.tsx";

const LAYER_LABEL: Record<SkillLayer | McpLayer, MessageKey> = {
  builtin: "agents.label.layer-builtin",
  global: "agents.label.layer-global",
  "place-data": "agents.label.layer-place-data",
  project: "agents.label.layer-project",
  app: "agents.label.layer-app",
  shared: "agents.label.layer-shared",
  agent: "agents.label.layer-agent",
};

const STATUS_LABEL: Record<"off" | "connected" | "needs-sign-in", MessageKey> =
  {
    off: "settings.label.off",
    connected: "settings.label.status-connected",
    "needs-sign-in": "settings.label.status-needs-sign-in",
  };

/** 토글. 이름은 줄 왼쪽에 따로 있어서 Switch의 라벨은 눈에는 숨기고 읽기용으로만 둔다. */
function RowToggle({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (on: boolean) => void;
}) {
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
export function SkillList({
  items,
  offNames = [],
  lockOff = false,
  showLayer = true,
  onToggle,
}: SkillListProps) {
  return (
    <ul className={styles.toggleList}>
      {items.map((item) => (
        <li key={item.name} className={styles.toggleRow} data-skill={item.name}>
          <span className={styles.toggleMain}>
            <span className={styles.toggleName}>{item.name}</span>
            <span className={styles.toggleDetail}>{item.detail}</span>
          </span>
          {showLayer && !item.builtIn ? (
            <span className={styles.chip}>{t(LAYER_LABEL[item.layer])}</span>
          ) : (
            <span />
          )}
          {item.builtIn ? (
            <span className={styles.toggleCell}>
              <span className={styles.chip} data-built-in="">
                {t("agents.label.built-in")}
              </span>
            </span>
          ) : (
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
  /** OAuth server의 로그인을 시작한다. 없으면 로그인 단추를 그리지 않는다. */
  readonly onSignIn?: (row: McpRow) => void;
  /** 기다리는 로그인을 그만둔다. */
  readonly onCancelSignIn?: (row: McpRow) => void;
  /** 이 화면이 시작해 기다리는 server 이름. 이 줄은 [Cancel]을 그린다. */
  readonly signingIn?: readonly string[];
}

/** MCP server 목록. 이름 옆 점이 연결 상태다. OAuth server는 로그인하지 않았으면 오른쪽에 [Sign in]이 있다. */
export function McpList({
  items,
  offNames = [],
  lockOff = false,
  showLayer = true,
  onToggle,
  onSignIn,
  onCancelSignIn,
  signingIn = [],
}: McpListProps) {
  return (
    <ul className={styles.toggleList}>
      {items.map((item) => {
        const on = item.on && !offNames.includes(item.name);
        const text = statusText(on, item.status);
        const login = on ? item.login : undefined;
        const canSignIn =
          login !== undefined &&
          onSignIn !== undefined &&
          login.state !== "signed_in";
        const waiting =
          login !== undefined &&
          (signingIn.includes(item.name) || login.state === "in_progress");
        return (
          <li
            key={item.name}
            className={`${styles.toggleRow} ${styles.mcpRow}`}
            data-mcp={item.name}
          >
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
                />
                {item.name}
              </span>
              <span className={styles.toggleDetail}>
                {text === "" ? item.detail : `${item.detail} · ${text}`}
              </span>
            </span>
            {showLayer ? (
              <span className={styles.chip}>{t(LAYER_LABEL[item.layer])}</span>
            ) : (
              <span />
            )}
            <span className={styles.toggleCell}>
              {login !== undefined && onSignIn !== undefined ? (
                waiting ? (
                  <Button
                    size="sm"
                    data-action="cancel-sign-in"
                    onClick={() => onCancelSignIn?.(item)}
                  >
                    {t("common.button.cancel")}
                  </Button>
                ) : canSignIn ? (
                  <Button
                    size="sm"
                    icon={actionIcons.connect}
                    data-action="sign-in"
                    onClick={() => onSignIn(item)}
                  >
                    {t("agents.button.sign-in")}
                  </Button>
                ) : null
              ) : null}
            </span>
            <RowToggle
              label={item.name}
              checked={on}
              disabled={lockOff && !item.on}
              onChange={(next) => onToggle(item.name, next)}
            />
          </li>
        );
      })}
    </ul>
  );
}

const SHAPE_LABEL: Record<CharacterProfile["shape"], MessageKey> = {
  square: "agents.label.character-square",
  capsule: "agents.label.character-capsule",
  wide: "agents.label.character-wide",
  pear: "agents.label.character-pear",
  round: "agents.label.character-round",
  arch: "agents.label.character-arch",
};

const COLOR_LABEL: Record<CharacterProfile["color"], MessageKey> = {
  coral: "agents.label.character-coral",
  periwinkle: "agents.label.character-periwinkle",
  yellow: "agents.label.character-yellow",
  sage: "agents.label.character-sage",
  lavender: "agents.label.character-lavender",
  peach: "agents.label.character-peach",
  blue: "agents.label.character-blue",
  teal: "agents.label.character-teal",
};

interface ProfileFieldProps {
  readonly value: Profile;
  /** 올린 이미지 파일 이름을 화면이 읽을 수 있는 주소로 푼다. */
  readonly imageSrc: (image: string) => string;
  /** 새 agent는 저장하기 전에는 이미지를 올릴 수 없다. */
  readonly canUpload: boolean;
  readonly onChange: (profile: Profile) => void;
  readonly onUpload: (file: File) => void;
}

export function ProfileField({
  value,
  imageSrc,
  canUpload,
  onChange,
  onUpload,
}: ProfileFieldProps) {
  const [grid, setGrid] = useState(true);
  const file = useRef<HTMLInputElement>(null);
  const character =
    value.kind === "character" ? value : DEFAULT_AGENT_CHARACTER;
  const shown: AvatarProfile =
    value.kind === "character"
      ? value
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
              icon={actionIcons.edit}
              aria-expanded={grid}
              onClick={() => setGrid(!grid)}
            >
              {t("agents.button.choose-character")}
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
              icon={actionIcons.upload}
              disabled={!canUpload}
              onClick={() => file.current?.click()}
            >
              {t("project-workspace.button.agent-editor-upload-image")}
            </Button>
            {value.kind === "image" ? (
              <Button
                size="sm"
                variant="ghost"
                icon={actionIcons.remove}
                onClick={() => onChange(DEFAULT_AGENT_CHARACTER)}
              >
                {t("agents.button.remove-image")}
              </Button>
            ) : null}
          </div>
          {grid && (
            <>
              <div
                className={styles.characterOptions}
                role="group"
                aria-label={t("agents.label.character-shape")}
              >
                <span className={styles.note}>
                  {t("agents.label.character-shape")}
                </span>
                <div className={styles.characterGrid}>
                  {AGENT_CHARACTER_SHAPES.map((shape) => (
                    <button
                      key={shape}
                      type="button"
                      className={styles.characterCell}
                      data-shape-option={shape}
                      aria-label={t(SHAPE_LABEL[shape])}
                      aria-pressed={
                        value.kind === "character" && value.shape === shape
                      }
                      onClick={() => onChange({ ...character, shape })}
                    >
                      <Avatar profile={{ ...character, shape }} size="lg" />
                    </button>
                  ))}
                </div>
              </div>
              <div
                className={styles.characterOptions}
                role="group"
                aria-label={t("agents.label.character-color")}
              >
                <span className={styles.note}>
                  {t("agents.label.character-color")}
                </span>
                <div className={styles.characterGrid}>
                  {AGENT_CHARACTER_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      className={styles.characterCell}
                      data-color-option={color}
                      aria-label={t(COLOR_LABEL[color])}
                      aria-pressed={
                        value.kind === "character" && value.color === color
                      }
                      onClick={() => onChange({ ...character, color })}
                    >
                      <Avatar profile={{ ...character, color }} size="lg" />
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
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

/** project 지침이 보기에서 보이는 줄 수. */
const PROJECT_LINES = 4;

interface InstructionsBlockProps {
  /** project 지침. null이면 이 agent는 project 지침을 받지 않는다(lophn, 앱 자리). */
  readonly project: ProjectInstructionsView | null;
  /** project 지침 머리 글. */
  readonly head: string;
  /** project 지침을 그 자리에서 고치는 길. */
  readonly port: InstructionsPort;
  /** project 지침을 받지 않는 이유 같은 안내. */
  readonly note?: string;
  readonly value: string;
  readonly help: string;
  readonly issues?: ReactNode;
  readonly onChange: (value: string) => void;
}

/** 지침 블록: project 지침과 이 agent의 지침을 같이 보이고 둘 다 이 자리에서 고친다. */
export function InstructionsBlock({
  project,
  head,
  port,
  note,
  value,
  help,
  issues,
  onChange,
}: InstructionsBlockProps) {
  return (
    <fieldset className={styles.group} data-field="instructions">
      <legend className={styles.legend}>
        {t("project-workspace.label.agent-editor-instructions")}
      </legend>
      {project === null ? null : (
        <div data-project-instructions="">
          <InstructionsEditor
            head={head}
            file={project}
            lines={PROJECT_LINES}
            empty={t("project-workspace.empty.agent-editor-no-project")}
            port={port}
          />
        </div>
      )}
      {note === undefined ? null : <p className={styles.note}>{note}</p>}
      <Field label={t("agents.label.agent-instructions")} help={help}>
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
export function ProtectedKeyNote({
  title,
  text,
  action,
}: {
  title: string;
  text: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className={styles.protected}>
      <span className={styles.protectedText}>
        <span className={styles.protectedTitle}>{title}</span>
        <span>{text}</span>
      </span>
      {action === undefined ? null : (
        <Button size="sm" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}

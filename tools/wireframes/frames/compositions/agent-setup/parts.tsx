// agent 설정 화면들이 같이 쓰는 조각: 층이 붙은 skill·MCP 목록, profile 칸, 지침 블록, agent 층 server 추가 form,
// 전역 기본 model 칸.
import { useEffect, useRef, useState } from "react";
import {
  Button,
  Field,
  Icon,
  Input,
  Select,
  Switch,
  Textarea,
  VendorIcon,
  vendorOf,
} from "@lophn/design/components";
import {
  lophnSpaceIcons,
} from "../../../../../packages/shell/renderer/icons/mod.ts";

import {
  AVATAR_ICON_LABEL,
  AVATAR_ICONS,
  ProfileAvatar,
} from "../agent-avatar.tsx";
import { type AgentProfile, AVATAR_ICON_KEYS } from "../agents-data.ts";
import {
  initialSelection,
  type ModelSelection,
  providerOf,
  withValue,
} from "../model-options.ts";
import { OptionAxes } from "../model-picker.tsx";
import { MODEL_CATALOG } from "../models-data.ts";
import type { McpItem, McpStatus, SkillItem } from "./setup-data.ts";
import s from "./agent-setup.module.css";

const STATUS_TEXT: Record<McpStatus, string> = {
  connected: "Connected",
  "needs-sign-in": "Needs sign-in",
  off: "Off",
};

/** 토글. 이름은 줄 왼쪽에 따로 있어서 Switch의 라벨은 눈에는 숨기고 읽기용으로만 둔다. */
function RowToggle(
  { label, defaultChecked }: { label: string; defaultChecked: boolean },
) {
  return (
    <span className={`${s.toggleCell} ${s.hiddenLabel}`}>
      <Switch label={label} defaultChecked={defaultChecked} />
    </span>
  );
}

/** skill 목록. 줄마다 어느 층의 것인지 chip으로 보이고, 오른쪽 끝 토글은 보고 있는 층에서의 켬·끔이다. */
export function SkillList(
  { items, offNames = [], showLayer = true }: {
    items: readonly SkillItem[];
    /** 보고 있는 층에서 꺼 둔 이름. 없으면 항목의 `on`을 따른다. */
    offNames?: readonly string[];
    showLayer?: boolean;
  },
) {
  return (
    <ul className={s.toggleList}>
      {items.map((item) => (
        <li key={item.name} className={s.toggleRow}>
          <span className={s.toggleMain}>
            <span className={s.toggleName}>{item.name}</span>
            <span className={s.toggleDetail}>{item.detail}</span>
          </span>
          {showLayer ? <span className={s.chip}>{item.layer}</span> : <span />}
          <RowToggle
            label={item.name}
            defaultChecked={item.on && !offNames.includes(item.name)}
          />
        </li>
      ))}
    </ul>
  );
}

/** MCP server 목록. 이름 옆 점이 연결 상태다. */
export function McpList(
  { items, onNames, showLayer = true }: {
    items: readonly McpItem[];
    /** 보고 있는 층에서 켠 이름. 없으면 항목의 `on`을 따른다. */
    onNames?: readonly string[];
    showLayer?: boolean;
  },
) {
  return (
    <ul className={s.toggleList}>
      {items.map((item) => (
        <li key={item.name} className={s.toggleRow}>
          <span className={s.toggleMain}>
            <span className={s.toggleName}>
              <span
                className={`${s.dot} ${s[`dot_${item.status}`]}`}
                role="img"
                aria-label={STATUS_TEXT[item.status]}
                title={STATUS_TEXT[item.status]}
              />
              {item.name}
            </span>
            <span className={s.toggleDetail}>
              {item.detail} · {STATUS_TEXT[item.status]}
            </span>
          </span>
          {showLayer ? <span className={s.chip}>{item.layer}</span> : <span />}
          <RowToggle
            label={item.name}
            defaultChecked={onNames === undefined
              ? item.on
              : onNames.includes(item.name)}
          />
        </li>
      ))}
    </ul>
  );
}

/** profile 칸: 미리보기, icon grid, 이미지 올리기. */
export function ProfileField(
  { value, onChange }: {
    value: AgentProfile;
    onChange: (profile: AgentProfile) => void;
  },
) {
  const [grid, setGrid] = useState(true);
  return (
    <fieldset className={s.group}>
      <legend className={s.legend}>Profile</legend>
      <div className={s.profileRow}>
        <ProfileAvatar profile={value} size="lg" label="Avatar preview" />
        <div className={s.profileTools}>
          <div className={s.profileButtons}>
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
              <div className={s.iconGrid} role="group" aria-label="Icons">
                {AVATAR_ICON_KEYS.map((key) => (
                  <button
                    key={key}
                    type="button"
                    className={s.iconCell}
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
          <p className={s.note}>
            An icon, or an image you upload. It shows next to the agent's
            messages.
          </p>
        </div>
      </div>
    </fieldset>
  );
}

/** 지침 블록: project 지침(읽기)과 이 agent의 지침(고침)을 같이 보인다. project 지침이 없으면 안내만 둔다. */
export function InstructionsBlock(
  { projectHead, projectBody, projectNote, agentValue, onAgentChange, help }: {
    /** project 지침 머리 글. 없으면 project 지침 칸을 그리지 않는다. */
    projectHead?: string;
    projectBody?: string;
    projectNote?: string;
    agentValue: string;
    onAgentChange?: (value: string) => void;
    help: string;
  },
) {
  return (
    <fieldset className={s.group}>
      <legend className={s.legend}>Instructions</legend>
      {projectHead === undefined ? null : (
        <div className={s.projectInstr}>
          <div className={s.projectInstrHead}>
            <span>{projectHead}</span>
            <Button size="sm">Edit LOPHN.md</Button>
          </div>
          <pre className={s.projectInstrBody}>{projectBody}</pre>
        </div>
      )}
      {projectNote === undefined
        ? null
        : <p className={s.note}>{projectNote}</p>}
      <Field label="Instructions for this agent" help={help}>
        <Textarea
          rows={7}
          value={agentValue}
          onChange={(event) => onAgentChange?.(event.currentTarget.value)}
        />
      </Field>
    </fieldset>
  );
}

const MODEL_CHOICES = MODEL_CATALOG.flatMap((group) =>
  group.models.map((model) => ({
    value: model.name,
    label: `${model.name} · ${group.provider}`,
  }))
);

/** 고른 model의 provider를 vendor 아이콘과 함께 보인다. */
function ModelProvider({ model }: { model: string }) {
  const provider = providerOf(model);
  const vendor = vendorOf(provider);
  return (
    <p className={s.modelProvider}>
      Provider
      <span className={s.vendorName}>
        {vendor === undefined ? null : <VendorIcon vendor={vendor} size={14} />}
        {provider}
      </span>
    </p>
  );
}

/** 위 층이 없는 model 칸(Workspace 전역 기본). model과 그 model의 option 축을 고른다. */
export function DefaultModelField(
  { value, onChange }: {
    value: ModelSelection;
    onChange: (value: ModelSelection) => void;
  },
) {
  return (
    <div className={s.group}>
      <Field label="Model">
        <Select
          options={MODEL_CHOICES}
          value={value.model}
          onValueChange={(next) =>
            onChange(
              next === value.model ? value : initialSelection(next),
            )}
        />
      </Field>
      <ModelProvider model={value.model} />
      <OptionAxes
        selection={value}
        onChange={(axis, next) => onChange(withValue(value, axis, next))}
      />
    </div>
  );
}

type Transport = "stdio" | "http";

/** protected 입력으로 받는다는 안내. 값은 이 창에서 치지 않는다. */
export function ProtectedKeyNote(
  { title, text, action }: { title: string; text: string; action?: string },
) {
  return (
    <div className={s.protected}>
      <span className={s.protectedText}>
        <span className={s.protectedTitle}>{title}</span>
        <span>{text}</span>
      </span>
      {action === undefined ? null : <Button size="sm">{action}</Button>}
    </div>
  );
}

/**
 * agent 층에서 MCP server를 더하는 form. 이름·연결 방식·실행이나 주소·로그인 방식만 받고 key나 token 값은
 * 받지 않는다. 더한 뒤 보호 입력으로 받는다.
 */
export function ServerForm(
  { taken, onDone, scrollIntoView = false }: {
    taken: readonly string[];
    onDone: () => void;
    scrollIntoView?: boolean;
  },
) {
  const [name, setName] = useState("");
  const [transport, setTransport] = useState<Transport>("stdio");
  const [auth, setAuth] = useState("none");
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scrollIntoView) root.current?.scrollIntoView({ block: "center" });
  }, [scrollIntoView]);
  const dup = name !== "" && taken.includes(name);
  return (
    <div
      ref={root}
      className={s.serverForm}
    >
      <h3 className={s.serverFormTitle}>Add a server for this agent only</h3>
      <Field
        label="Name"
        help="Lowercase letters, numbers and hyphens. Other agents don't see this server."
        error={dup ? "A server with this name already exists." : undefined}
      >
        <Input
          value={name}
          autoComplete="off"
          onChange={(event) => setName(event.currentTarget.value)}
        />
      </Field>
      <Field label="Connects">
        <Select
          options={[
            { value: "stdio", label: "On this computer" },
            { value: "http", label: "Over the web" },
          ]}
          value={transport}
          onValueChange={(value) => setTransport(value as Transport)}
        />
      </Field>
      {transport === "stdio"
        ? (
          <>
            <Field label="Program" help="The exact path or command that runs.">
              <Input defaultValue="npx" />
            </Field>
            <Field label="Arguments" help="One per line.">
              <Textarea
                rows={3}
                defaultValue="-y
@acme/notes-mcp"
              />
            </Field>
          </>
        )
        : (
          <>
            <Field label="Address">
              <Input defaultValue="https://mcp.example.com/notes" />
            </Field>
            <Field label="Sign-in">
              <Select
                options={[
                  { value: "none", label: "None" },
                  { value: "bearer", label: "Bearer token" },
                  { value: "api_key", label: "API key in a header" },
                ]}
                value={auth}
                onValueChange={setAuth}
              />
            </Field>
          </>
        )}
      {transport === "http" && auth !== "none"
        ? (
          <ProtectedKeyNote
            title="Key or token"
            text="Typed in a protected prompt after you add the server. It isn't typed here and isn't shown again."
          />
        )
        : (
          <p className={s.note}>
            If the server needs a key or token, lophn asks for it in a protected
            prompt after you add it.
          </p>
        )}
      <div className={s.formActions}>
        <Button onClick={onDone}>Cancel</Button>
        <Button variant="primary" icon={lophnSpaceIcons.add} onClick={onDone}>
          Add server
        </Button>
      </div>
    </div>
  );
}

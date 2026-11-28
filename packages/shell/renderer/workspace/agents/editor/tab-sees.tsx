// Sees 탭(무엇을 보나): 범위 · Browser profile · MCP servers · 배포받은 앱 skill · custom이 고르는 tool · Permission mode · 다른 컴퓨터 앱 할당.
// 다른 컴퓨터 앱 할당은 바로 저장되고(editor가 그린 apps 조각) 나머지는 [Save]로 저장한다. harness는 자기 tool과 MCP를 써서
// 그 두 칸 대신 그렇다는 한 줄이 선다.

import { t } from "@lophn/i18n";
import { Field, Input, SegmentedControl, Select } from "@lophn/ui/input";
import { Button } from "@lophn/ui/primitives";
import { type ReactNode, useState } from "react";

import type { AgentWorkspace } from "../../../../../protocol/lophn-agent/agent-values.ts";
import type {
  McpServer,
  McpTrust,
} from "../../../../../protocol/lophn-agent/mcp-settings.ts";
import {
  PERMISSION_MODES,
  type PermissionMode,
} from "../../../../../protocol/lophn-agent/turn-values.ts";
import { workspaceOfLophn } from "../../../../../protocol/lophn-agent/workspaces.ts";
import { useBrowserProfiles } from "../../../browser/profiles.tsx";
import { actionIcons } from "../../../icons/mod.ts";
import { scopeLabel } from "../agent-card.tsx";
import { runtimeLabel } from "../agent-glance.tsx";
import { secretsOf } from "../mcp-secrets.ts";
import type { AgentDraft } from "../source.ts";
import type { DeployableSkill, McpLogin, McpRow, McpSecret } from "../views.ts";
import styles from "./agent-editor.module.css";
import {
  type AgentFacts,
  type FormProps,
  issuesOf,
  withField,
} from "./editor-model.ts";
import { DeployedSkills } from "./deployed-skills.tsx";
import { Group, Issues } from "./form-kit.tsx";
import { McpList } from "./parts.tsx";
import { ServerForm } from "./server-form.tsx";
import { ToolPicks } from "./tool-picks.tsx";

// Select는 빈 값을 못 쓴다. 기본 profile·전역 권한 기본(정의에 칸이 없다)의 값이다.
const DEFAULT_PROFILE_VALUE = "default";
const DEFAULT_MODE_VALUE = "default";

/** 정의 층 MCP server를 목록 줄로 바꾼다. 로그인 상태는 저장된 정의의 server에만 있다. */
export function ownServers(
  definition: AgentDraft,
  logins: Readonly<Record<string, McpLogin>>,
): McpRow[] {
  return (definition.mcp_servers ?? []).map((server) => {
    const login = logins[server.name];
    const secrets = secretsOf(server);
    return {
      name: server.name,
      detail:
        server.transport === "stdio"
          ? server.stdio.executable
          : server.http.url,
      layer: "agent",
      on: server.enabled,
      trust: server.trust ?? "untrusted",
      status:
        login === undefined
          ? null
          : login.state === "signed_in"
            ? "connected"
            : "needs-sign-in",
      ...(login === undefined ? {} : { login }),
      ...(secrets.length === 0 ? {} : { secrets }),
    };
  });
}

interface SeesTabProps extends FormProps {
  readonly facts: AgentFacts;
  /** 다른 컴퓨터 앱 할당 조각. 바로 저장되므로 editor가 그 상태를 쥐고 그린다. */
  readonly apps: ReactNode;
  /** 배포할 수 있는 앱 skill 전부. 읽는 중이거나 읽지 못했으면 null이다. */
  readonly deployable: readonly DeployableSkill[] | null;
  /** OAuth MCP server의 [Sign in]. */
  readonly onSignIn: (row: McpRow) => void;
  /** 기다리는 로그인의 [Cancel]. */
  readonly onCancelSignIn: (row: McpRow) => void;
  /** 이 화면이 시작해 기다리는 server 이름. */
  readonly signingIn: readonly string[];
  /** server의 secret 한 자리의 [Set]·[Change]. 보호 입력 창이 열린다. */
  readonly onSetSecret: (row: McpRow, secret: McpSecret) => void;
}

export function SeesTab(props: SeesTabProps) {
  const { detail, definition, facts, onChange } = props;
  const { fresh, lophn, custom, harness, runtime } = facts;
  const [addServer, setAddServer] = useState(false);
  const issues = (name: Parameters<typeof issuesOf>[1]) =>
    issuesOf(props.issues, name);
  const set = (key: Parameters<typeof withField>[1], value: unknown) =>
    onChange(withField(definition, key, value));
  // lophn의 정의 file에는 workspace 칸이 없다(id가 말한다).
  const scope =
    detail.assignment !== null && lophn
      ? workspaceOfLophn(detail.assignment)
      : definition.workspace;
  // 새 agent가 고를 수 있는 범위: 화면을 연 workspace. home이나 Settings는 없고 전역뿐이다.
  const here =
    detail.workspace.kind === "none" || detail.workspace.kind === "home"
      ? null
      : ({
          kind: detail.workspace.kind,
          id: detail.workspace.id,
        } as AgentWorkspace);
  // 정의의 profile이 지금 목록에 없으면(지웠다) 기본으로 보이고 그렇다고 알린다. 정의 file은 사람이 고르기 전까지 그대로다.
  const profiles = useBrowserProfiles();
  const picked = profiles.find((one) => one.id === definition.browser_profile);
  const deletedProfile =
    definition.browser_profile !== undefined && picked === undefined;
  // credential 이름이 쓰는 이 agent의 id. 새 agent는 저장 전에 미리 받은 id를 쓴다.
  const agentId = detail.assignment ?? detail.draftId;
  const mcpOff = (definition.mcp_off ?? [])
    .filter((entry) => entry.original_tool === undefined)
    .map((entry) => entry.server_name);
  const own = ownServers(definition, detail.agentMcpLogins);
  const ownNote = t("agents.notice.own-tools", {
    runtime: runtimeLabel(runtime),
  });

  return (
    <div className={styles.form}>
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
              onValueChange={(choice) =>
                set("workspace", choice === "here" ? here : undefined)
              }
            />
          ) : (
            <Input
              value={scopeLabel(scope, props.workspaceName, lophn)}
              readOnly
            />
          )}
        </Field>
        <Issues issues={issues("workspace")} />
      </div>

      <div data-field="browser_profile">
        <Field
          label={t("agents.label.browser-profile")}
          help={t("agents.notice.browser-profile-help")}
        >
          <Select
            options={[
              {
                value: DEFAULT_PROFILE_VALUE,
                label: t("agents.label.browser-profile-default"),
              },
              ...profiles.map((one) => ({ value: one.id, label: one.name })),
            ]}
            value={picked?.id ?? DEFAULT_PROFILE_VALUE}
            onValueChange={(value) =>
              set(
                "browser_profile",
                value === DEFAULT_PROFILE_VALUE ? undefined : value,
              )
            }
          />
        </Field>
        {deletedProfile ? (
          <p className={styles.note} data-profile-deleted="">
            {t("agents.notice.browser-profile-deleted")}
          </p>
        ) : null}
        <Issues issues={issues("browser_profile")} />
      </div>

      <Group
        name="mcp"
        heading={t("project-workspace.heading.agent-editor-mcp")}
      >
        {harness ? (
          <p className={styles.note} data-own="mcp">
            {ownNote}
          </p>
        ) : (
          <>
            <McpList
              items={[...detail.mcpServers, ...own]}
              offNames={mcpOff}
              lockOff
              onSignIn={props.onSignIn}
              onCancelSignIn={props.onCancelSignIn}
              signingIn={props.signingIn}
              onSetSecret={props.onSetSecret}
              canSetTrust={(row) => row.layer === "agent"}
              onSetTrust={(row, trust: McpTrust) => {
                if (row.layer !== "agent") return;
                set(
                  "mcp_servers",
                  (definition.mcp_servers ?? []).map((server) =>
                    server.name === row.name ? { ...server, trust } : server,
                  ),
                );
              }}
              onToggle={(name, on) => {
                if (own.some((row) => row.name === name)) {
                  set(
                    "mcp_servers",
                    (definition.mcp_servers ?? []).map((server) =>
                      server.name === name
                        ? { ...server, enabled: on }
                        : server,
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
                  set("mcp_servers", [
                    ...(definition.mcp_servers ?? []),
                    server,
                  ]);
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
          </>
        )}
        <Issues issues={issues("mcp")} />
      </Group>

      <Group
        name="deployed_skills"
        heading={t("agents.heading.deployed-skills")}
      >
        {harness ? (
          <p className={styles.note} data-own="deployed_skills">
            {ownNote}
          </p>
        ) : (
          <>
            <DeployedSkills
              entries={definition.deployed_skills ?? []}
              deployable={props.deployable}
              onChange={(next) => set("deployed_skills", next)}
            />
            <p className={styles.note}>
              {t("agents.notice.deployed-skills-agent")}
            </p>
          </>
        )}
        <Issues issues={issues("deployed_skills")} />
      </Group>

      {custom || harness ? (
        <Group name="tools" heading={t("agents.heading.tools")}>
          {harness ? (
            <p className={styles.note} data-own="tools">
              {ownNote}
            </p>
          ) : (
            <>
              <ToolPicks
                value={definition.tools ?? []}
                onChange={(tools) => set("tools", tools)}
              />
              <p className={styles.note}>{t("agents.notice.tools-help")}</p>
            </>
          )}
          <Issues issues={issues("tools")} entries={definition.tools} />
        </Group>
      ) : null}

      <Group
        name="permission_mode"
        heading={t("agents.heading.permission-mode")}
      >
        <Field
          label={t("agents.label.field-permission-mode")}
          help={t("agents.notice.permission-mode-help")}
        >
          <Select
            options={[
              {
                value: DEFAULT_MODE_VALUE,
                label: t("agents.label.permission-mode-default"),
              },
              ...PERMISSION_MODES.map((mode) => ({
                value: mode,
                label: t(`agents.label.permission-mode-${mode}`),
              })),
            ]}
            value={definition.permission_mode ?? DEFAULT_MODE_VALUE}
            onValueChange={(value) =>
              set(
                "permission_mode",
                value === DEFAULT_MODE_VALUE
                  ? undefined
                  : (value as PermissionMode),
              )
            }
          />
        </Field>
        <Issues issues={issues("permission_mode")} />
      </Group>

      <section className={styles.apps} data-field="apps">
        {props.apps}
      </section>
    </div>
  );
}

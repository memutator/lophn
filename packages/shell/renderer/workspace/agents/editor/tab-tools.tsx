// Tools 탭: bare가 고르는 tool · MCP servers · shell extensions.
import { useState } from "react";
import { Checkbox } from "@lophn/ui/input";
import { Button } from "@lophn/ui/primitives";
import { t } from "@lophn/i18n";

import { extensionToolModelName } from "../../../../../protocol/extensions/manifest.ts";
import type { PublishedExtension } from "../../../../../protocol/lophn-agent/extension-tools.ts";
import type { McpServer } from "../../../../../protocol/lophn-agent/mcp-settings.ts";
import { actionIcons } from "../../../icons/mod.ts";
import type { AgentDraft } from "../source.ts";
import type { McpLogin, McpRow } from "../views.ts";
import {
  type AgentFacts,
  type FormProps,
  issuesOf,
  withField,
} from "./editor-model.ts";
import { Group, Issues } from "./form-kit.tsx";
import { McpList } from "./parts.tsx";
import { ServerForm } from "./server-form.tsx";
import { ToolPicks } from "./tool-picks.tsx";
import styles from "./agent-editor.module.css";

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

interface ToolsTabProps extends FormProps {
  readonly facts: AgentFacts;
  /** OAuth MCP server의 [Sign in]. */
  readonly onSignIn: (row: McpRow) => void;
  /** 기다리는 로그인의 [Cancel]. */
  readonly onCancelSignIn: (row: McpRow) => void;
  /** 이 화면이 시작해 기다리는 server 이름. */
  readonly signingIn: readonly string[];
  /** 설치되고 켜진 shell extension(core의 `extension_tools/catalog`). */
  readonly extensions: readonly PublishedExtension[];
}

export function ToolsTab(props: ToolsTabProps) {
  const { detail, definition, facts, onChange } = props;
  const { bare } = facts;
  const [addServer, setAddServer] = useState(false);
  const issues = (name: Parameters<typeof issuesOf>[1]) =>
    issuesOf(props.issues, name);
  const set = (key: Parameters<typeof withField>[1], value: unknown) =>
    onChange(withField(definition, key, value));
  // credential 이름이 쓰는 이 agent의 id. 새 agent는 저장 전에 미리 받은 id를 쓴다.
  const agentId = detail.assignment ?? detail.draftId;

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

  return (
    <div className={styles.form}>
      {bare ? (
        <Group name="tools" heading={t("agents.heading.tools")}>
          <ToolPicks
            value={definition.tools ?? []}
            extensionTools={extensionToolNames}
            onChange={(tools) => set("tools", tools)}
          />
          <p className={styles.note}>{t("agents.notice.tools-help")}</p>
          <Issues issues={issues("tools")} entries={definition.tools} />
        </Group>
      ) : null}

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
        <Issues issues={issues("mcp")} />
      </Group>

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
          <Issues issues={issues("extensions")} />
        </Group>
      )}
    </div>
  );
}

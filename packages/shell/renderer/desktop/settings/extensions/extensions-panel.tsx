import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@lophn/ui/primitives";
import { ErrorState, Loading, Skeleton } from "@lophn/ui/feedback";
import { t } from "@lophn/i18n";

import { settingsList } from "../../../../../protocol/config/file.ts";
import {
  type McpServer,
  mcpAuthState,
} from "../../../../../protocol/lophn-agent/mcp-settings.ts";
import { skillsRead } from "../../../../../protocol/lophn-agent/skill-settings.ts";
import { secretStatus } from "../../../../../protocol/secrets/secret-file.ts";
import { actionIcons } from "../../../icons/mod.ts";
import { useCoreRead } from "../../connection/core-read.ts";
import { effectiveOf } from "../declared.ts";
import {
  authStateInput,
  authStatesOf,
  extensionSettingsOf,
  MCP_SERVERS,
  secretStatesOf,
  SKILL_FOLDERS,
} from "../extension-settings.ts";
import { extensionsViewOf, serverSecretNames } from "../agents/core-source.ts";
import { ServerForm } from "../../../workspace/agents/editor/server-form.tsx";
import { McpList, SkillList } from "../../../workspace/agents/editor/parts.tsx";
import type {
  AgentsSettingsSource,
  McpRow,
  SourceResult,
} from "../agents/settings-source.ts";
import styles from "./extensions.module.css";

interface ExtensionsPanelProps {
  source: AgentsSettingsSource;
}

// Settings › Tools and skills. 전역 층의 skill과 MCP server다. 줄마다 켬·끔 토글이 오른쪽 끝에 있고 층 표시는 없다.
// server를 더하는 form은 agent 설정 화면의 것과 같다. key나 token 값은 이 화면이 받지 않고 보호 입력이 받는다.
// 같은 이름은 project나 agent 층이 덮는다.

type Notice =
  | { readonly kind: "added"; readonly name: string }
  | { readonly kind: "failed" }
  | { readonly kind: "server-failed"; readonly name: string };

function noticeText(notice: Notice): string {
  switch (notice.kind) {
    case "added":
      return t("settings.extensions.server-added", { name: notice.name });
    case "failed":
      return t("settings.agents.action-failed");
    case "server-failed":
      return t("settings.extensions.server-failed", { name: notice.name });
  }
}

export function ExtensionsPanel({ source }: ExtensionsPanelProps): ReactNode {
  // skill 목록, server 설정, credential 저장 여부, 로그인 상태를 따로 읽는다. 다른 창이나 agent가 바꾸거나 browser
  // 로그인이 끝나도 따라간다. 상태를 읽지 못하면 그 칸만 모른다고 본다.
  const skills = useCoreRead(skillsRead, {});
  const settings = useCoreRead(settingsList, {
    keys: [SKILL_FOLDERS, MCP_SERVERS],
  });
  const servers = useMemo(
    () =>
      settings.loaded.state === "ready"
        ? extensionSettingsOf(effectiveOf(settings.loaded.value)).servers
        : [],
    [settings.loaded],
  );
  const secrets = useCoreRead(secretStatus, {});
  const logins = useCoreRead(mcpAuthState, authStateInput(servers));
  const view = useMemo(
    () =>
      skills.loaded.state !== "ready" || settings.loaded.state === "loading"
        ? null
        : extensionsViewOf(
            skills.loaded.value.skills,
            servers,
            secrets.loaded.state === "ready"
              ? secretStatesOf(serverSecretNames(servers), secrets.loaded.value)
              : null,
            logins.loaded.state === "ready"
              ? authStatesOf(logins.loaded.value)
              : null,
          ),
    [skills.loaded, settings.loaded, servers, secrets.loaded, logins.loaded],
  );
  const [notice, setNotice] = useState<Notice | null>(null);
  const [adding, setAdding] = useState(false);
  // 이 화면이 시작해 아직 callback을 기다리는 로그인이다.
  const [signingIn, setSigningIn] = useState<readonly string[]>([]);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  if (skills.loaded.state === "failed") {
    return (
      <ErrorState
        target={t("settings.label.extensions-target")}
        onRetry={skills.reload}
      />
    );
  }

  // 한 번 부르고 실패하면 알린다. 바뀐 값은 core가 낸 변경으로 다시 읽힌다.
  async function act(call: () => Promise<SourceResult<null>>): Promise<void> {
    setNotice(null);
    const done = await call();
    if (!alive.current) return;
    if (!done.ok) setNotice({ kind: "failed" });
  }

  async function signIn(row: McpRow): Promise<void> {
    setNotice(null);
    setSigningIn((was) => [...was, row.name]);
    const done = await source.signInServer(row);
    if (!alive.current) return;
    setSigningIn((was) => was.filter((one) => one !== row.name));
    if (!done.ok) setNotice({ kind: "failed" });
  }

  async function cancelSignIn(row: McpRow): Promise<void> {
    await source.cancelServerSignIn(row);
    if (!alive.current) return;
    setSigningIn((was) => was.filter((one) => one !== row.name));
  }

  async function add(server: McpServer): Promise<void> {
    setNotice(null);
    setAdding(false);
    const done = await source.createServer(server);
    if (!alive.current) return;
    setNotice(
      done.ok
        ? { kind: "added", name: server.name }
        : { kind: "server-failed", name: server.name },
    );
  }

  return (
    <Loading loading={view === null} placeholder={<Skeleton lines={6} />}>
      {view === null ? null : (
        <div className={styles.page} data-extensions="">
          <h1 className={styles.title}>{t("settings.label.tab-extensions")}</h1>
          <p className={styles.lead}>
            {t("agents.notice.settings-tools-lead")}
          </p>
          {notice === null ? null : (
            <p
              className={styles.notice}
              role="status"
              data-notice={notice.kind}
            >
              {noticeText(notice)}
            </p>
          )}

          <section data-section="skills">
            <div className={styles.sectionHead}>
              <h2 className={styles.sectionTitle}>
                {t("settings.heading.agents-skills")}
              </h2>
              <Button
                size="sm"
                icon={actionIcons.add}
                data-action="add-skill"
                onClick={() => void act(() => source.addSkill())}
              >
                {t("settings.button.add-skill")}
              </Button>
            </div>
            {view.skills.length === 0 ? (
              <p className={styles.empty} data-empty="">
                {t("settings.agents.no-skills")}
              </p>
            ) : (
              <SkillList
                items={view.skills}
                showLayer={false}
                onToggle={(name, on) =>
                  void act(() => source.setSkillEnabled(name, on))
                }
              />
            )}
            <p className={styles.note}>
              {t("agents.notice.settings-tools-skills")}
            </p>
          </section>

          <section className={styles.section} data-section="servers">
            <div className={styles.sectionHead}>
              <h2 className={styles.sectionTitle}>
                {t("settings.heading.agents-servers")}
              </h2>
              <Button
                size="sm"
                icon={actionIcons.add}
                data-action="add-server"
                disabled={adding}
                onClick={() => setAdding(true)}
              >
                {t("settings.button.add-server")}
              </Button>
            </div>
            {adding ? (
              <ServerForm
                scope="global"
                oauth
                taken={view.servers.map((server) => server.name)}
                scrollIntoView
                onAdd={(server) => void add(server)}
                onCancel={() => setAdding(false)}
              />
            ) : null}
            {view.servers.length === 0 ? (
              <p className={styles.empty} data-empty="">
                {t("settings.agents.no-servers")}
              </p>
            ) : (
              <McpList
                items={view.servers}
                showLayer={false}
                signingIn={signingIn}
                onSignIn={(row) => void signIn(row)}
                onCancelSignIn={(row) => void cancelSignIn(row)}
                onSetSecret={(row, secret) =>
                  void act(() => source.enterServerSecret(row, secret))
                }
                onToggle={(name, on) =>
                  void act(() => source.setServerEnabled(name, on))
                }
              />
            )}
            <p className={styles.note}>
              {t("agents.notice.settings-tools-servers")}
            </p>
          </section>
        </div>
      )}
    </Loading>
  );
}

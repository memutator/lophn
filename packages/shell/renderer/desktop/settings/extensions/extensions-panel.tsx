import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Button } from "@lophn/ui/primitives";
import { ErrorState, Loading, Skeleton } from "@lophn/ui/feedback";
import { t } from "@lophn/wording";

import type { McpServer } from "../../../../../protocol/lophn-agent/mcp-settings.ts";
import { commonIcons } from "../../../icons/mod.ts";
import { ServerForm } from "../../../workspace/agents/editor/server-form.tsx";
import { McpList, SkillList } from "../../../workspace/agents/editor/parts.tsx";
import type {
  AgentsSettingsSource,
  ExtensionsView,
  SourceResult,
} from "../agents/settings-source.ts";
import styles from "./extensions.module.css";

interface ExtensionsPanelProps {
  source: AgentsSettingsSource;
}

// Settings › Tools and skills. 전역 층의 skill과 MCP server다. 줄마다 켬·끔 토글이 오른쪽 끝에 있고 층 표시는 없다.
// server를 더하는 form은 agent 설정 화면의 것과 같다. key나 token 값은 이 화면이 받지 않고 보호 입력이 받는다.
// 같은 이름은 project나 agent 층이 덮는다.

type Loaded =
  | { readonly state: "loading" }
  | { readonly state: "failed" }
  | { readonly state: "ready"; readonly view: ExtensionsView };

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
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  const [notice, setNotice] = useState<Notice | null>(null);
  const [adding, setAdding] = useState(false);
  const alive = useRef(true);

  const load = useCallback(() => {
    void source.readExtensions().then((result) => {
      if (!alive.current) return;
      // 다시 읽다 실패해도 보이던 값은 그대로 둔다. 처음 읽기만 읽지 못했다고 보인다.
      setLoaded((was) =>
        result.ok
          ? { state: "ready", view: result.value }
          : was.state === "ready"
            ? was
            : { state: "failed" },
      );
    });
  }, [source]);
  useEffect(() => {
    alive.current = true;
    load();
    return () => {
      alive.current = false;
    };
  }, [load]);

  if (loaded.state === "failed") {
    return (
      <ErrorState
        target={t("settings.label.extensions-target")}
        onRetry={() => {
          setLoaded({ state: "loading" });
          load();
        }}
      />
    );
  }
  const view = loaded.state === "ready" ? loaded.view : null;

  // 한 번 부르고 실패하면 알린다. 값이 바뀌었을 수 있으니 어느 쪽이든 다시 읽는다.
  async function act(call: () => Promise<SourceResult<null>>): Promise<void> {
    setNotice(null);
    const done = await call();
    if (!alive.current) return;
    if (!done.ok) setNotice({ kind: "failed" });
    load();
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
    load();
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
                icon={commonIcons.add}
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
                icon={commonIcons.add}
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

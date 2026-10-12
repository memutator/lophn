// settings의 확장 자리(flow add-agent-extension 1·2). 로컬 skill 폴더를 등록하고 외부 도구 server를 더한다.
// 실패하면 무엇이 그대로인지와 다음 행동 하나를 말한다. 확장을 넣어도 권한은 넓어지지 않으며
// 어떤 Preset이 쓰는지는 roles 화면의 Preset에서 고른다.
import { useCallback, useState } from "react";
import {
  Button,
  ErrorState,
  Loading,
  Skeleton,
} from "@lophn/design/components";
import { t } from "@lophn/wording";

import { folderName, serverAuthLabel } from "../model.ts";
import type {
  NewServer,
  ServerRow,
  SettingsSource,
  SettingsView,
} from "../source.ts";
import { useReload } from "../use-reload.ts";
import styles from "../settings.module.css";
import { ServerForm } from "./server-form.tsx";

type Loaded =
  | { readonly state: "loading" }
  | { readonly state: "failed" }
  | { readonly state: "ready"; readonly view: SettingsView };

type Notice =
  | { readonly kind: "folder-added"; readonly name: string }
  | { readonly kind: "server-added"; readonly name: string }
  | { readonly kind: "window-opened" }
  | { readonly kind: "window-failed" }
  | { readonly kind: "changed" }
  | { readonly kind: "folder-failed" }
  | { readonly kind: "server-failed"; readonly name: string };

function noticeText(notice: Notice): string {
  switch (notice.kind) {
    case "folder-added":
      return t("settings.extensions.folder-added", { name: notice.name });
    case "server-added":
      return t("settings.extensions.server-added", { name: notice.name });
    case "window-opened":
      return t("settings.notice.window-opened");
    case "window-failed":
      return t("settings.error.window");
    case "changed":
      return t("settings.error.changed");
    case "folder-failed":
      return t("settings.extensions.folder-failed");
    case "server-failed":
      return t("settings.extensions.server-failed", { name: notice.name });
  }
}

/**
 * 로그인을 시작하지 못한 이유 한 줄. 줄마다 하나이고 이름으로 찾는다. 로그인이 돌고 있는지, 끝났는지, 왜
 * 실패했는지는 여기가 아니라 core가 읽어 준 상태가 말한다. starting은 시작 요청을 보낸 뒤 답이 오기 전이다.
 */
type SignInState = "starting" | "busy" | "not-opened" | "failed";

function signInText(state: SignInState, name: string): string | null {
  switch (state) {
    case "starting":
      return null;
    case "busy":
      return t("settings.server.sign-in-busy");
    case "not-opened":
      return t("settings.server.sign-in-not-opened");
    case "failed":
      return t("settings.server.sign-in-failed", { name });
  }
}

/** core가 읽어 준 로그인 상태의 한 줄. 상태를 읽지 못한 줄은 아는 척하지 않는다. */
function loginText(signIn: NonNullable<ServerRow["signIn"]>): string | null {
  switch (signIn.state) {
    case "none":
      return t("settings.server.sign-in-needed");
    case "in_progress":
      return t("settings.sign-in.waiting");
    case "signed_in":
      return t("settings.server.signed-in");
    case "unknown":
      return null;
    case "failed":
      switch (signIn.reason) {
        case "callback_timeout":
          return t("settings.server.sign-in-reason-callback-timeout");
        case "state_mismatch":
          return t("settings.server.sign-in-reason-state-mismatch");
        case "exchange_failed":
        case null:
          return t("settings.server.sign-in-reason-exchange-failed");
        case "refresh_rejected":
          return t("settings.server.sign-in-reason-refresh-rejected");
        case "expired":
          return t("settings.server.sign-in-reason-expired");
        case "store_failed":
          return t("settings.server.sign-in-reason-store-failed");
      }
  }
}

function credentialText(server: ServerRow): string | null {
  switch (server.credential) {
    case "set":
      return t("settings.server.credential-set");
    case "missing":
      return t("settings.server.credential-missing");
    case "unknown":
      return t("settings.server.credential-unknown");
    case null:
      return null;
  }
}

export function ExtensionsPanel({ source }: { source: SettingsSource }) {
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [signIns, setSignIns] = useState<Record<string, SignInState>>({});

  const load = useCallback(() => {
    void source.settings().then((result) => {
      setLoaded(
        result.ok
          ? { state: "ready", view: result.value }
          : { state: "failed" },
      );
    });
  }, [source]);
  useReload(source, load);

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

  async function addFolder(current: SettingsView): Promise<void> {
    setBusy(true);
    const added = await source.addSkillFolder(current);
    setBusy(false);
    if (added.ok) {
      if (added.value !== null) {
        setNotice({
          kind: "folder-added",
          name: folderName(added.value.path),
        });
      }
    } else {
      setNotice({
        kind: added.code === "conflict" ? "changed" : "folder-failed",
      });
    }
    load();
  }

  async function addServer(
    current: SettingsView,
    server: NewServer,
  ): Promise<void> {
    setBusy(true);
    const added = await source.addServer(current, server);
    setBusy(false);
    if (added.ok) {
      setNotice({ kind: "server-added", name: server.name });
      setAdding(false);
    } else {
      setNotice(
        added.code === "conflict"
          ? { kind: "changed" }
          : { kind: "server-failed", name: server.name },
      );
    }
    load();
  }

  async function enterCredential(secret: string): Promise<void> {
    const opened = await source.enterServerCredential(secret);
    setNotice({ kind: opened.ok ? "window-opened" : "window-failed" });
  }

  // 인증 주소를 browser로 열고 사람이 돌아올 때까지 기다린다. 줄의 상태는 core가 읽어 준 값이라 시작한 직후와
  // 끝난 뒤에 목록을 다시 읽어 그린다(끝났다는 기억을 화면이 쥐지 않는다).
  async function signIn(server: ServerRow): Promise<void> {
    const mark = (state: SignInState | null) =>
      setSignIns((current) => {
        const { [server.name]: _gone, ...rest } = current;
        return state === null ? rest : { ...rest, [server.name]: state };
      });
    mark("starting");
    const begun = await source.beginSignIn(server);
    if (!begun.ok) {
      mark(
        begun.code === "conflict"
          ? "busy"
          : begun.code === "not_opened"
          ? "not-opened"
          : "failed",
      );
      load();
      return;
    }
    mark(null);
    load();
    await source.finishSignIn(server, begun.value.callbackPort);
    load();
  }

  // 기다리는 로그인을 그만둔다. 기다리던 요청은 충돌로 끝나고 줄은 core가 읽어 준 none으로 돌아온다.
  async function cancelSignIn(server: ServerRow): Promise<void> {
    await source.cancelSignIn(server);
    load();
  }

  return (
    <Loading
      loading={view === null}
      placeholder={<Skeleton lines={4} />}
    >
      <div className={styles.groups} data-extensions="">
        <p className={styles.text}>{t("settings.extensions.intro")}</p>
        {notice === null ? null : (
          <p
            className={styles.notice}
            role="status"
            data-notice={notice.kind}
          >
            {noticeText(notice)}
          </p>
        )}
        <section className={styles.section} data-skills="">
          <div className={styles.cardHead}>
            <h2 className={styles.heading}>
              {t("settings.heading.skills")}
            </h2>
            <Button
              size="sm"
              variant="secondary"
              data-action="add-folder"
              disabled={busy || view === null}
              onClick={() => view !== null && void addFolder(view)}
            >
              {t("settings.button.add-folder")}
            </Button>
          </div>
          {view !== null && view.folders.length === 0
            ? (
              <p className={styles.empty} data-skills-empty="">
                {t("settings.extensions.no-folders")}
              </p>
            )
            : (
              <ul className={styles.rows}>
                {(view?.folders ?? []).map((path) => (
                  <li key={path} className={styles.row} data-folder="">
                    <span className={styles.rowText}>
                      <span className={styles.subheading} data-folder-name="">
                        {folderName(path)}
                      </span>
                      <details className={styles.details}>
                        <summary>{t("settings.label.details")}</summary>
                        <dl>
                          <dt>{t("settings.label.location")}</dt>
                          <dd>{path}</dd>
                        </dl>
                      </details>
                    </span>
                  </li>
                ))}
              </ul>
            )}
        </section>
        <section className={styles.section} data-servers="">
          <div className={styles.cardHead}>
            <h2 className={styles.heading}>
              {t("settings.heading.servers")}
            </h2>
            <Button
              size="sm"
              variant="secondary"
              data-action="show-server-form"
              aria-expanded={adding}
              onClick={() => setAdding(!adding)}
            >
              {t("settings.button.new-server")}
            </Button>
          </div>
          {adding && view !== null
            ? (
              <ServerForm
                taken={view.servers.map((server) => server.name)}
                busy={busy}
                onAdd={(server) => void addServer(view, server)}
              />
            )
            : null}
          {view !== null && view.servers.length === 0
            ? (
              <p className={styles.empty} data-servers-empty="">
                {t("settings.extensions.no-servers")}
              </p>
            )
            : (
              <ul className={styles.rows}>
                {(view?.servers ?? []).map((server) => (
                  <li
                    key={server.name}
                    className={styles.row}
                    data-server={server.name}
                  >
                    <span className={styles.rowText}>
                      <span className={styles.subheading}>{server.name}</span>
                      <span className={styles.muted}>
                        {[
                          server.transport === "stdio"
                            ? t("settings.label.on-computer")
                            : t("settings.label.over-web"),
                          serverAuthLabel(server.auth),
                          server.enabled ? null : t("settings.label.off"),
                        ].filter((part) => part !== null).join(" · ")}
                      </span>
                      {signIns[server.name] === undefined ||
                          signIns[server.name] === "starting"
                        ? null
                        : (
                          <span
                            className={styles.text}
                            role="status"
                            data-sign-in={signIns[server.name]}
                          >
                            {signInText(signIns[server.name]!, server.name)}
                          </span>
                        )}
                      {server.signIn === null ||
                          loginText(server.signIn) === null
                        ? null
                        : (
                          <span
                            className={styles.text}
                            data-sign-in-state={server.signIn.state}
                          >
                            {loginText(server.signIn)}
                          </span>
                        )}
                      {credentialText(server) === null ? null : (
                        <span
                          className={styles.text}
                          data-credential={server.credential ?? "none"}
                        >
                          {credentialText(server)}
                        </span>
                      )}
                    </span>
                    {server.signIn !== null &&
                        server.signIn.state === "in_progress"
                      ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          data-action="cancel-sign-in"
                          onClick={() => void cancelSignIn(server)}
                        >
                          {t("settings.button.cancel-sign-in")}
                        </Button>
                      )
                      : server.signIn !== null &&
                          server.signIn.state !== "signed_in"
                      ? (
                        <Button
                          size="sm"
                          data-action="sign-in"
                          disabled={signIns[server.name] === "starting"}
                          onClick={() => void signIn(server)}
                        >
                          {t("settings.button.server-sign-in")}
                        </Button>
                      )
                      : null}
                    {server.secret !== null && server.credential !== "set"
                      ? (
                        <Button
                          size="sm"
                          data-action="enter-credential"
                          onClick={() => void enterCredential(server.secret!)}
                        >
                          {t("settings.button.enter-credential")}
                        </Button>
                      )
                      : null}
                  </li>
                ))}
              </ul>
            )}
        </section>
      </div>
    </Loading>
  );
}

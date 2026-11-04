// Settings › Extensions. 본체와 따로 켜는 기능의 목록이다. 줄마다 이름, 설명, 판, 상태가 있고
// [Install]은 표시 file을 두고, [Turn on]·[Turn off]는 설정 `extensions.<id>.enabled`를 바꾸고,
// [Remove]는 확인 dialog 뒤에 extension이 쓴 file만 지운다. 켜져 있으면 지울 수 없어 먼저 끄라고 알린다.
// 이름이 비슷한 Tools and skills(lophn agent의 skill 폴더·MCP server)와 다르다.
import { useCallback, useMemo, useState } from "react";
import { Button } from "@lophn/ui/primitives";
import { ErrorState, Loading, Skeleton, StatusMark } from "@lophn/ui/feedback";
import { Dialog } from "@lophn/ui/overlay";
import { t } from "@lophn/i18n";

import type { ExtensionView } from "../../../../ipc/extensions.ts";
import { actionIcons } from "../../../icons/mod.ts";
import type { SettingsSource } from "../source.ts";
import { useReload } from "../use-reload.ts";
import styles from "../settings.module.css";
import { windowExtensionsApi } from "./core-source.ts";
import { enabledKey, statusText, statusTone } from "./model.ts";

interface ExtensionPackagesPanelProps {
  source: SettingsSource;
}

type Loaded =
  | { readonly state: "loading" }
  | { readonly state: "failed" }
  | {
      readonly state: "ready";
      readonly views: readonly ExtensionView[];
      /** 선언된 `extensions.<id>.enabled`의 값. 선언이 없는 id는 빠진다. */
      readonly enabled: ReadonlyMap<string, boolean>;
    };

export function ExtensionPackagesPanel({
  source,
}: ExtensionPackagesPanelProps) {
  const api = useMemo(windowExtensionsApi, []);
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<ExtensionView | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const load = useCallback(() => {
    if (api === undefined) {
      setLoaded({ state: "failed" });
      return;
    }
    void Promise.all([api.list(), source.declared()]).then(
      ([list, declared]) => {
        setLoaded((was) => {
          if (!list.ok)
            return was.state === "ready" ? was : { state: "failed" };
          const enabled = new Map<string, boolean>();
          if (declared.ok) {
            for (const entry of declared.value) {
              enabled.set(
                entry.key,
                (entry.hasChosen ? entry.chosen : entry.defaultValue) === true,
              );
            }
          }
          return { state: "ready", views: list.value, enabled };
        });
      },
    );
  }, [api, source]);
  useReload(source, load);

  async function run(
    view: ExtensionView,
    action: () => Promise<{ ok: boolean; code?: string }>,
  ): Promise<void> {
    setBusy(true);
    setProblem(null);
    const done = await action();
    setBusy(false);
    if (!done.ok) {
      setProblem(
        done.code === "conflict"
          ? t("settings.error.extension-turn-off-first", { name: view.name })
          : t("settings.error.extension-action", { name: view.name }),
      );
    }
    load();
  }

  const turn = (view: ExtensionView, on: boolean) =>
    run(view, async () => {
      const done = await source.update([
        { key: enabledKey(view.id), action: "set", value: on },
      ]);
      return done.ok && done.value.rejected.length === 0
        ? { ok: true }
        : { ok: false };
    });

  const remove = (view: ExtensionView) =>
    run(view, async () => {
      const done = await api!.remove(view.id);
      return done.ok ? { ok: true } : { ok: false, code: done.error.code };
    });

  if (loaded.state === "failed") {
    return (
      <ErrorState
        target={t("settings.label.extension-target")}
        onRetry={() => {
          setLoaded({ state: "loading" });
          load();
        }}
      />
    );
  }
  const views = loaded.state === "ready" ? loaded.views : [];
  return (
    <div data-extension-packages="">
      <h1 className={styles.paneTitle}>
        {t("settings.label.tab-extension-packages")}
      </h1>
      <p className={styles.lead}>{t("settings.intro.extension-packages")}</p>
      {problem === null ? null : (
        <p className={styles.rejected} role="alert" data-extension="failed">
          {problem}
        </p>
      )}
      <Loading
        loading={loaded.state === "loading"}
        placeholder={<Skeleton lines={3} />}
      >
        {views.length === 0 ? (
          <p className={styles.lineHelp} data-extension="empty">
            {t("settings.empty.extension-packages")}
          </p>
        ) : (
          <ul className={styles.lines}>
            {views.map((view) => {
              const enabled =
                loaded.state === "ready"
                  ? loaded.enabled.get(enabledKey(view.id))
                  : undefined;
              return (
                <li
                  key={view.id}
                  className={styles.line}
                  data-extension-id={view.id}
                >
                  <div className={styles.lineMain}>
                    <span className={styles.lineName}>{view.name}</span>
                    <p className={styles.lineHelp}>{view.description}</p>
                    <span className={styles.caption}>
                      {t("settings.label.extension-version", {
                        version: view.version,
                      })}
                    </span>
                    {view.reason === undefined ? null : (
                      <span className={styles.caption}>{view.reason}</span>
                    )}
                  </div>
                  <div className={styles.lineControl}>
                    <StatusMark
                      tone={statusTone(view)}
                      label={statusText(view)}
                    />
                    <div className={styles.actions}>
                      {!view.installed ? (
                        <Button
                          icon={actionIcons.add}
                          disabled={busy || api === undefined}
                          data-action="install"
                          onClick={() =>
                            void run(view, async () => {
                              const done = await api!.install(view.id);
                              return { ok: done.ok };
                            })
                          }
                        >
                          {t("settings.button.extension-install")}
                        </Button>
                      ) : null}
                      {view.installed && enabled === false ? (
                        <Button
                          disabled={busy}
                          data-action="turn-on"
                          onClick={() => void turn(view, true)}
                        >
                          {t("settings.button.extension-turn-on")}
                        </Button>
                      ) : null}
                      {enabled === true ? (
                        <Button
                          disabled={busy}
                          data-action="turn-off"
                          onClick={() => void turn(view, false)}
                        >
                          {t("settings.button.extension-turn-off")}
                        </Button>
                      ) : null}
                      {view.installed ? (
                        <Button
                          variant="ghost"
                          icon={actionIcons.remove}
                          disabled={busy}
                          data-action="remove"
                          onClick={() =>
                            enabled === true
                              ? setProblem(
                                  t("settings.error.extension-turn-off-first", {
                                    name: view.name,
                                  }),
                                )
                              : setRemoving(view)
                          }
                        >
                          {t("settings.button.extension-remove")}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Loading>
      <Dialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title={t("settings.title.extension-remove", {
          name: removing?.name ?? "",
        })}
        actions={
          <>
            <Button onClick={() => setRemoving(null)}>
              {t("settings.button.cancel")}
            </Button>
            <Button
              variant="danger"
              icon={actionIcons.remove}
              data-action="confirm-remove"
              onClick={() => {
                const view = removing;
                setRemoving(null);
                if (view !== null) void remove(view);
              }}
            >
              {t("settings.button.extension-remove")}
            </Button>
          </>
        }
      >
        <p>
          {t("settings.note.extension-remove", { name: removing?.name ?? "" })}
        </p>
      </Dialog>
    </div>
  );
}

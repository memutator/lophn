// Settings › Extensions. 본체와 따로 켜는 기능의 목록이다. 줄마다 이름, 설명, 판, 상태가 있고
// [Install]은 표시 file을 두고, [Turn on]·[Turn off]는 설정 `extensions.<id>.enabled`를 바꾸고,
// [Remove]는 확인 dialog 뒤에 extension이 쓴 file만 지운다. 켜져 있으면 지울 수 없어 먼저 끄라고 알린다.
// 이름이 비슷한 Tools and skills(lophn agent의 skill 폴더·MCP server)와 다르다.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@lophn/ui/primitives";
import { ErrorState, Loading, Skeleton, StatusMark } from "@lophn/ui/feedback";
import { Dialog } from "@lophn/ui/overlay";
import { t } from "@lophn/i18n";

import { settingsList } from "../../../../../protocol/config/file.ts";
import type { ExtensionView } from "../../../../../protocol/extensions/routes.ts";
import { actionIcons } from "../../../icons/mod.ts";
import { useCoreRead } from "../../connection/core-read.ts";
import { useEventClient } from "../../connection/events/hooks.tsx";
import { effectiveOf } from "../declared.ts";
import type { SettingsSource } from "../source.ts";
import styles from "../settings.module.css";
import { coreExtensions } from "./core-source.ts";
import { enabledKey, statusText, statusTone } from "./model.ts";

interface ExtensionPackagesPanelProps {
  source: SettingsSource;
}

type Listed =
  | { readonly state: "loading" }
  | { readonly state: "failed" }
  | { readonly state: "ready"; readonly views: readonly ExtensionView[] };

export function ExtensionPackagesPanel({
  source,
}: ExtensionPackagesPanelProps) {
  const client = useEventClient();
  const api = useMemo(() => coreExtensions(client.core), [client]);
  // 켜짐은 설정 `extensions.<id>.enabled`다. 목록의 상태(on·off)도 core가 그 설정을 따라 바꾸므로 설정을 다시
  // 읽을 때마다 목록도 다시 읽는다.
  const { loaded: settings } = useCoreRead(settingsList, {});
  const [listed, setListed] = useState<Listed>({ state: "loading" });
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<ExtensionView | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const list = useCallback(() => {
    void api.list().then((read) => {
      setListed((was) =>
        read.ok
          ? { state: "ready", views: read.value }
          : was.state === "ready"
            ? was
            : { state: "failed" },
      );
    });
  }, [api]);
  useEffect(list, [list, settings]);
  const enabled = useMemo(() => {
    const values =
      settings.state === "ready" ? effectiveOf(settings.value) : new Map();
    return (id: string): boolean | undefined => {
      const value = values.get(enabledKey(id));
      return value === undefined ? undefined : value === true;
    };
  }, [settings]);

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
    // 설치·지우기는 extension host의 file 일이라 core가 바뀜을 알리지 않는다.
    list();
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
      const done = await api.remove(view.id);
      return done.ok ? { ok: true } : { ok: false, code: done.error.code };
    });

  if (listed.state === "failed") {
    return (
      <ErrorState
        target={t("settings.label.extension-target")}
        onRetry={() => {
          setListed({ state: "loading" });
          list();
        }}
      />
    );
  }
  const views = listed.state === "ready" ? listed.views : [];
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
        loading={listed.state === "loading"}
        placeholder={<Skeleton lines={3} />}
      >
        {views.length === 0 ? (
          <p className={styles.lineHelp} data-extension="empty">
            {t("settings.empty.extension-packages")}
          </p>
        ) : (
          <ul className={styles.lines}>
            {views.map((view) => {
              const on = enabled(view.id);
              return (
                <li
                  key={view.id}
                  className={styles.line}
                  data-extension-id={view.id}
                >
                  <div className={styles.lineMain}>
                    <span className={styles.lineName}>{view.name}</span>
                    <p className={styles.lineHelp}>{view.description}</p>
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
                          disabled={busy}
                          data-action="install"
                          onClick={() =>
                            void run(view, async () => {
                              const done = await api.install(view.id);
                              return { ok: done.ok };
                            })
                          }
                        >
                          {t("settings.button.extension-install")}
                        </Button>
                      ) : null}
                      {view.installed && on === false ? (
                        <Button
                          disabled={busy}
                          data-action="turn-on"
                          onClick={() => void turn(view, true)}
                        >
                          {t("settings.button.extension-turn-on")}
                        </Button>
                      ) : null}
                      {on === true ? (
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
                            on === true
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

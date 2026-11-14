// Settings › Coding agents. 제품마다 즐겨찾기(맨 왼쪽), 실행 파일, version, turn 끝 신호, hook, 실행 명령어를 보인다. 연결 만들기·범위·
// 이름·회수와 doctor 단계는 없다. 감지는 사람이 [Detect again]을 누를 때만 다시 한다. 즐겨찾기와 명령어는 빠른 실행 전역 값이다.
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import {
  harnessVendorOf,
  VendorIcon,
} from "../../../parts/vendor-icon/vendor-icon.tsx";
import { Button, IconToggle } from "@lophn/ui/primitives";
import { FieldContext, Input, SearchFilter } from "@lophn/ui/input";
import { ErrorState, Loading, Skeleton, StatusMark } from "@lophn/ui/feedback";
import { t } from "@lophn/i18n";

import { HARNESS_ADAPTERS } from "../../../../../protocol/coding-agent/harness-adapter.ts";
import type { HarnessId } from "../../../../../protocol/coding-agent/harness-id.ts";
import { actionIcons, browserIcons } from "../../../icons/mod.ts";
import {
  SHARED_APPS_SETTING_KEY,
  sharedAppsSettingSchema,
} from "../../../../../protocol/approvals/share-request.ts";
import { settingsList } from "../../../../../protocol/config/file.ts";
import { useCoreRead } from "../../connection/core-read.ts";
import { effectiveOf } from "../declared.ts";
import { useQuickPrefs } from "../quick-launch/store.tsx";
import styles from "../settings.module.css";
import {
  discoveryText,
  discoveryTone,
  hookText,
  hookTone,
  matchesQuery,
  shown,
  sortedByFound,
  versionText,
} from "./model.ts";
import type {
  CodingConnectionsSource,
  HarnessHookView,
  HarnessName,
  HarnessSettingsView,
} from "./source.ts";

interface CodingConnectionsPanelProps {
  source: CodingConnectionsSource;
}

type Loaded =
  | { readonly state: "loading" }
  | { readonly state: "failed" }
  | {
      readonly state: "ready";
      readonly harnesses: readonly HarnessSettingsView[];
    };

type HookAction = "install" | "uninstall";

/** 제품 이름 앞에 vendor 아이콘을 붙인다. 아이콘은 이름이 아니라 harness id로 고른다. */
function ProductName({
  harness,
  label,
}: {
  harness: HarnessName;
  label: string;
}) {
  const vendor = harnessVendorOf(harness);
  return (
    <span className={styles.productName}>
      {vendor === undefined ? null : <VendorIcon vendor={vendor} />}
      {label}
    </span>
  );
}
export function CodingConnectionsPanel({
  source,
}: CodingConnectionsPanelProps) {
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  const [detecting, setDetecting] = useState(false);
  const [detectFailed, setDetectFailed] = useState(false);
  // 읽지 못했으면 비어 있어 hook 칸은 "-"다. 제품 감지와 따로 읽어 서로 막지 않는다.
  const [hooks, setHooks] = useState<readonly HarnessHookView[]>([]);
  const [changing, setChanging] = useState<HarnessName | null>(null);
  const [hookFailed, setHookFailed] = useState<HookAction | null>(null);
  // 공유 요청 승인과 다른 창도 이 목록을 바꾼다. 못 읽었거나 모양이 틀리면 비어 보인다.
  const { loaded: sharedRead } = useCoreRead(settingsList, {
    keys: [SHARED_APPS_SETTING_KEY],
  });
  const shared = useMemo(() => {
    if (sharedRead.state !== "ready") return [];
    const parsed = sharedAppsSettingSchema.safeParse(
      effectiveOf(sharedRead.value).get(SHARED_APPS_SETTING_KEY),
    );
    return parsed.success ? parsed.data : [];
  }, [sharedRead]);
  const [unshareFailed, setUnshareFailed] = useState(false);
  const [query, setQuery] = useState("");
  const { prefs, set } = useQuickPrefs();
  const coding = prefs.coding;
  const toggleFavorite = (id: HarnessId) =>
    set("coding", {
      ...coding,
      favorites: coding.favorites.includes(id)
        ? coding.favorites.filter((item) => item !== id)
        : [...coding.favorites, id],
    });
  const setCommand = (id: HarnessId, command: string) => {
    const { [id]: _old, ...rest } = coding.commands;
    const text = command.trim();
    set("coding", {
      ...coding,
      commands: text === "" ? rest : { ...rest, [id]: text },
    });
  };

  const load = useCallback(() => {
    void source.harnesses().then((read) => {
      setLoaded(
        read.ok
          ? { state: "ready", harnesses: read.value }
          : { state: "failed" },
      );
    });
    void source.hookStatus().then((read) => {
      if (read.ok) setHooks(read.value);
    });
  }, [source]);
  // 감지 결과와 hook 상태는 core가 아니라 main IPC라 변경 알림이 없다. 열 때 읽고 사람이 바꾼 뒤 다시 읽는다.
  useEffect(load, [load]);

  async function detectAgain(): Promise<void> {
    setDetecting(true);
    setDetectFailed(false);
    const read = await source.refresh();
    setDetecting(false);
    if (read.ok) setLoaded({ state: "ready", harnesses: read.value });
    else setDetectFailed(true);
  }

  async function changeHooks(
    harness: HarnessName,
    action: HookAction,
  ): Promise<void> {
    setChanging(harness);
    setHookFailed(null);
    const done =
      action === "install"
        ? await source.installHooks(harness)
        : await source.uninstallHooks(harness);
    // 쓴 결과를 믿지 않고 다시 읽어 보인다.
    const read = await source.hookStatus();
    setChanging(null);
    if (read.ok) setHooks(read.value);
    const wanted = action === "install" ? "installed" : "missing";
    if (!done.ok || done.value.status !== wanted) setHookFailed(action);
  }

  async function unshare(slug: string): Promise<void> {
    const done = await source.unshareApp(slug);
    setUnshareFailed(!done.ok);
  }

  if (loaded.state === "failed") {
    return (
      <ErrorState
        target={t("settings.label.coding-target")}
        onRetry={() => {
          setLoaded({ state: "loading" });
          load();
        }}
      />
    );
  }
  const harnesses = loaded.state === "ready" ? loaded.harnesses : [];
  const rows = sortedByFound(harnesses).filter((harness) =>
    matchesQuery(harness, query),
  );
  return (
    <div data-coding="">
      <h1 className={styles.paneTitle}>{t("settings.label.tab-coding")}</h1>
      <p className={styles.lead}>{t("settings.intro.coding")}</p>
      <div className={styles.toolbar}>
        <span className={styles.lineHelp}>
          {t("settings.note.coding-detect-note")}
        </span>
        <Button
          icon={actionIcons.refresh}
          disabled={detecting}
          data-action="detect"
          onClick={() => void detectAgain()}
        >
          {t("settings.button.detect-again")}
        </Button>
      </div>
      {detectFailed ? (
        <p className={styles.rejected} role="alert" data-detect="failed">
          {t("settings.error.coding-detect")}
        </p>
      ) : null}
      {hookFailed === "install" ? (
        <p className={styles.rejected} role="alert" data-hooks="failed">
          {t("settings.error.coding-hooks-install")}
        </p>
      ) : null}
      {hookFailed === "uninstall" ? (
        <p className={styles.rejected} role="alert" data-hooks="failed">
          {t("settings.error.coding-hooks-uninstall")}
        </p>
      ) : null}
      {unshareFailed ? (
        <p className={styles.rejected} role="alert" data-shared="failed">
          {t("settings.error.coding-unshare")}
        </p>
      ) : null}
      <Loading
        loading={loaded.state === "loading"}
        placeholder={<Skeleton lines={5} />}
      >
        <div className={styles.searchRow}>
          <SearchFilter value={query} onChange={setQuery} />
        </div>
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">{t("settings.label.coding-col-favorite")}</th>
                <th scope="col">{t("settings.label.coding-col-product")}</th>
                <th scope="col">{t("settings.label.coding-col-executable")}</th>
                <th scope="col">{t("settings.label.coding-col-turn-end")}</th>
                <th scope="col">{t("settings.label.coding-col-hooks")}</th>
                <th scope="col">{t("settings.label.coding-col-command")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((harness) => (
                <HarnessRow
                  key={harness.harness_id}
                  harness={harness}
                  hook={hooks.find(
                    (hook) => hook.harness_id === harness.harness_id,
                  )}
                  changing={changing === harness.harness_id}
                  onChange={(action) =>
                    void changeHooks(harness.harness_id, action)
                  }
                  command={coding.commands[harness.harness_id as HarnessId]}
                  onCommand={(command) =>
                    setCommand(harness.harness_id as HarnessId, command)
                  }
                  favorite={coding.favorites.includes(
                    harness.harness_id as HarnessId,
                  )}
                  onFavorite={() =>
                    toggleFavorite(harness.harness_id as HarnessId)
                  }
                />
              ))}
            </tbody>
          </table>
        </div>
        {rows.length === 0 ? (
          <p
            className={`${styles.lineHelp} ${styles.tableNote}`}
            data-search="empty"
          >
            {t("settings.empty.coding-search")}
          </p>
        ) : null}
        <p className={`${styles.lineHelp} ${styles.tableNote}`}>
          {t("settings.note.coding-hooks")}
        </p>
        <p className={`${styles.lineHelp} ${styles.tableNote}`}>
          {t("settings.note.coding-favorites")}
        </p>
        <section className={styles.groupBlock} data-shared-apps="">
          <h2 className={styles.groupTitle}>
            {t("settings.label.coding-shared-apps")}
          </h2>
          <p className={styles.lineHelp}>
            {t("settings.note.coding-shared-apps")}
          </p>
          {shared.length === 0 ? (
            <p className={styles.lineHelp} data-shared="empty">
              {t("settings.empty.coding-shared-apps")}
            </p>
          ) : (
            <ul className={styles.lines}>
              {shared.map((slug) => (
                <li key={slug} className={styles.line} data-shared-app={slug}>
                  <div className={styles.lineMain}>
                    <span className={`${styles.lineName} ${styles.mono}`}>
                      {slug}
                    </span>
                  </div>
                  <div className={styles.lineControl}>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={actionIcons.remove}
                      data-action="unshare"
                      onClick={() => void unshare(slug)}
                    >
                      {t("settings.button.coding-unshare")}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </Loading>
    </div>
  );
}

function HarnessRow({
  harness,
  hook,
  changing,
  onChange,
  command,
  onCommand,
  favorite,
  onFavorite,
}: {
  harness: HarnessSettingsView;
  hook: HarnessHookView | undefined;
  changing: boolean;
  onChange: (action: HookAction) => void;
  command: string | undefined;
  onCommand: (command: string) => void;
  favorite: boolean;
  onFavorite: () => void;
}) {
  const found = shown(harness);
  const version = versionText(harness);
  return (
    <tr data-harness={harness.harness_id}>
      <td>
        <IconToggle
          icon={browserIcons.star}
          label={t(
            favorite
              ? "settings.button.coding-unfavorite"
              : "settings.button.coding-favorite",
          )}
          size="sm"
          pressed={favorite}
          data-action="favorite"
          onClick={onFavorite}
        />
      </td>
      <td>
        <ProductName harness={harness.harness_id} label={harness.label} />
      </td>
      <td>
        <div className={styles.cell}>
          <StatusMark
            tone={discoveryTone(harness)}
            label={discoveryText(harness)}
          />
          {version === null ? null : (
            <span className={styles.caption}>{version}</span>
          )}
        </div>
      </td>
      <td>
        {found ? (
          <StatusMark
            tone={harness.can_deliver_messages ? "good" : "warning"}
            label={
              harness.can_deliver_messages
                ? t("settings.label.coding-signal-yes")
                : t("settings.label.coding-signal-no")
            }
          />
        ) : (
          <span className={styles.dim}>-</span>
        )}
      </td>
      <td>
        <HookCell hook={hook} changing={changing} onChange={onChange} />
      </td>
      <td>
        <CommandCell
          harness={harness}
          command={command}
          onCommand={onCommand}
        />
      </td>
    </tr>
  );
}

/** 전역 hook 상태. 안 놓였으면 [Install hooks], 놓였으면 [Uninstall hooks]가 있고, hook이 없는 제품은 "-"다. */
function HookCell({
  hook,
  changing,
  onChange,
}: {
  hook: HarnessHookView | undefined;
  changing: boolean;
  onChange: (action: HookAction) => void;
}) {
  const text = hook === undefined ? null : hookText(hook);
  if (hook === undefined || text === null) {
    return <span className={styles.dim}>-</span>;
  }
  return (
    <div className={styles.cell}>
      <StatusMark tone={hookTone(hook)} label={text} />
      {hook.status === "missing" ? (
        <Button
          icon={actionIcons.add}
          disabled={changing}
          data-action="install-hooks"
          onClick={() => onChange("install")}
        >
          {t("settings.button.install-hooks")}
        </Button>
      ) : null}
      {hook.status === "installed" ? (
        <Button
          variant="ghost"
          icon={actionIcons.remove}
          disabled={changing}
          data-action="uninstall-hooks"
          onClick={() => onChange("uninstall")}
        >
          {t("settings.button.uninstall-hooks")}
        </Button>
      ) : null}
    </div>
  );
}

/** 터미널에서 실행할 명령어. 비우면 adapter의 기본 명령어이고, 칸을 떠나거나 Enter를 누를 때 저장한다. */
function CommandCell({
  harness,
  command,
  onCommand,
}: {
  harness: HarnessSettingsView;
  command: string | undefined;
  onCommand: (command: string) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const fallback =
    HARNESS_ADAPTERS[harness.harness_id as HarnessId]?.commands[0] ?? "";
  const commit = () => {
    if (draft !== null && draft.trim() !== (command ?? "")) onCommand(draft);
    setDraft(null);
  };
  return (
    <FieldContext.Provider value={{ id, invalid: false }}>
      <Input
        size="sm"
        aria-label={t("settings.label.coding-col-command")}
        placeholder={fallback}
        value={draft ?? command ?? ""}
        data-command={harness.harness_id}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
          if (event.key === "Escape") setDraft(null);
        }}
      />
    </FieldContext.Provider>
  );
}

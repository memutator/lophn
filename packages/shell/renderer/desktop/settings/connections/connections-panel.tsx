// Settings › Coding agents. 제품마다 실행 파일, version, turn 끝 신호를 보인다. 연결 만들기·범위·이름·회수와
// doctor 단계는 없다. 감지는 사람이 [Detect again]을 누를 때만 다시 한다.
import { useCallback, useState } from "react";
import {
  harnessVendorOf,
  VendorIcon,
} from "../../../parts/vendor-icon/vendor-icon.tsx";
import { Button } from "@lophn/ui/primitives";
import { SearchFilter } from "@lophn/ui/input";
import { ErrorState, Loading, Skeleton, StatusMark } from "@lophn/ui/feedback";
import { t } from "@lophn/i18n";

import { retryIcon } from "../../../icons/mod.ts";
import { useReload } from "../use-reload.ts";
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
  const [query, setQuery] = useState("");

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
  useReload(source, load);

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
          icon={retryIcon}
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
                <th scope="col">{t("settings.label.coding-col-product")}</th>
                <th scope="col">{t("settings.label.coding-col-executable")}</th>
                <th scope="col">{t("settings.label.coding-col-turn-end")}</th>
                <th scope="col">{t("settings.label.coding-col-hooks")}</th>
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
      </Loading>
    </div>
  );
}

function HarnessRow({
  harness,
  hook,
  changing,
  onChange,
}: {
  harness: HarnessSettingsView;
  hook: HarnessHookView | undefined;
  changing: boolean;
  onChange: (action: HookAction) => void;
}) {
  const found = shown(harness);
  const version = versionText(harness);
  return (
    <tr data-harness={harness.harness_id}>
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

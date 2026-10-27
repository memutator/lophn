// Settings › Coding agents. 제품마다 실행 파일, version, turn 끝 신호, 맡길 수 있는지를 보이고
// 기본 실행 옵션을 정한다. 연결 만들기·범위·이름·회수와 doctor 단계는 없다. 감지는 사람이
// [Detect again]을 누를 때만 다시 한다.
import { useCallback, useState } from "react";
import {
  harnessVendorOf,
  VendorIcon,
} from "../../../parts/vendor-icon/vendor-icon.tsx";
import { Button } from "@lophn/ui/primitives";
import { Field, Input, SearchFilter } from "@lophn/ui/input";
import { ErrorState, Loading, Skeleton, StatusMark } from "@lophn/ui/feedback";
import { t } from "@lophn/wording";

import { retryIcon } from "../../../icons/mod.ts";
import { useReload } from "../use-reload.ts";
import styles from "../settings.module.css";
import {
  discoveryText,
  discoveryTone,
  hookText,
  hookTone,
  matchesQuery,
  pickable,
  shown,
  sortedByFound,
  versionText,
} from "./model.ts";
import type {
  CodingConnectionsSource,
  CodingDefaults,
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

const EMPTY_DEFAULTS: CodingDefaults = { harness: null, model: "" };

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
  const [installing, setInstalling] = useState<HarnessName | null>(null);
  const [installFailed, setInstallFailed] = useState(false);
  const [defaults, setDefaults] = useState<CodingDefaults>(EMPTY_DEFAULTS);
  const [saved, setSaved] = useState<"idle" | "saved" | "failed">("idle");
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
    void source.defaults().then((read) => {
      if (read.ok) setDefaults(read.value);
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

  async function installHooks(harness: HarnessName): Promise<void> {
    setInstalling(harness);
    setInstallFailed(false);
    const done = await source.installHooks(harness);
    // 쓴 결과를 믿지 않고 다시 읽어 보인다.
    const read = await source.hookStatus();
    setInstalling(null);
    if (read.ok) setHooks(read.value);
    setInstallFailed(!done.ok || done.value.status !== "installed");
  }

  async function save(): Promise<void> {
    setSaved("idle");
    const result = await source.saveDefaults({
      ...defaults,
      model: defaults.model.trim(),
    });
    setSaved(result.ok ? "saved" : "failed");
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
      {installFailed ? (
        <p className={styles.rejected} role="alert" data-hooks="failed">
          {t("settings.error.coding-hooks-install")}
        </p>
      ) : null}
      <Loading
        loading={loaded.state === "loading"}
        placeholder={<Skeleton lines={5} />}
      >
        <SearchFilter value={query} onChange={setQuery} />
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">{t("settings.label.coding-col-product")}</th>
                <th scope="col">{t("settings.label.coding-col-executable")}</th>
                <th scope="col">{t("settings.label.coding-col-turn-end")}</th>
                <th scope="col">{t("settings.label.coding-col-takes-task")}</th>
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
                  installing={installing === harness.harness_id}
                  onInstall={() => void installHooks(harness.harness_id)}
                />
              ))}
            </tbody>
          </table>
        </div>
        {rows.length === 0 ? (
          <p className={styles.lineHelp} data-search="empty">
            {t("settings.empty.coding-search")}
          </p>
        ) : null}
        <p className={`${styles.lineHelp} ${styles.groupBlock}`}>
          {t("settings.note.coding-signal")}
        </p>
        <p className={styles.lineHelp}>{t("settings.note.coding-hooks")}</p>
        <section className={styles.groupBlock}>
          <h2 className={styles.groupTitle}>
            {t("settings.heading.coding-defaults")}
          </h2>
          <div className={styles.options}>
            <ProductPicker
              harnesses={harnesses}
              value={defaults.harness}
              onChange={(harness) => {
                setSaved("idle");
                setDefaults({ ...defaults, harness });
              }}
            />
            <Field
              label={t("settings.label.coding-model")}
              help={t("settings.note.coding-model")}
            >
              <Input
                value={defaults.model}
                onChange={(event) => {
                  setSaved("idle");
                  setDefaults({ ...defaults, model: event.target.value });
                }}
              />
            </Field>
            <div className={styles.endSlot}>
              <Button
                variant="primary"
                data-action="save"
                onClick={() => void save()}
              >
                {t("settings.button.save")}
              </Button>
            </div>
            {saved === "saved" ? (
              <p className={styles.lineHelp} role="status" data-saved="">
                {t("settings.note.coding-defaults-saved")}
              </p>
            ) : null}
            {saved === "failed" ? (
              <p className={styles.rejected} role="alert" data-saved="failed">
                {t("settings.error.coding-defaults")}
              </p>
            ) : null}
          </div>
        </section>
      </Loading>
    </div>
  );
}

function HarnessRow({
  harness,
  hook,
  installing,
  onInstall,
}: {
  harness: HarnessSettingsView;
  hook: HarnessHookView | undefined;
  installing: boolean;
  onInstall: () => void;
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
        {found ? (
          <div className={styles.cell}>
            <StatusMark
              tone={harness.can_launch ? "good" : "critical"}
              label={
                harness.can_launch
                  ? t("settings.label.coding-launch-yes")
                  : t("settings.label.coding-launch-no")
              }
            />
            {harness.reason === null ? null : (
              <span className={styles.caption}>{harness.reason}</span>
            )}
          </div>
        ) : (
          <span className={styles.dim}>-</span>
        )}
      </td>
      <td>
        <HookCell hook={hook} installing={installing} onInstall={onInstall} />
      </td>
    </tr>
  );
}

/** 전역 hook 상태. 안 놓였을 때만 [Install hooks]가 있고, hook이 없는 제품은 "-"다. */
function HookCell({
  hook,
  installing,
  onInstall,
}: {
  hook: HarnessHookView | undefined;
  installing: boolean;
  onInstall: () => void;
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
          disabled={installing}
          data-action="install-hooks"
          onClick={onInstall}
        >
          {t("settings.button.install-hooks")}
        </Button>
      ) : null}
    </div>
  );
}

/** 기본 제품 고르기. 제품마다 아이콘이 붙은 줄이다. 맡길 수 없는 제품은 목록에 없다. */
function ProductPicker({
  harnesses,
  value,
  onChange,
}: {
  harnesses: readonly HarnessSettingsView[];
  value: HarnessName | null;
  onChange: (harness: HarnessName | null) => void;
}) {
  const legend = t("settings.label.coding-default-product");
  return (
    <fieldset className={styles.productPicker}>
      <legend>{legend}</legend>
      <div role="radiogroup" aria-label={legend}>
        <button
          type="button"
          role="radio"
          aria-checked={value === null}
          className={styles.productOption}
          onClick={() => onChange(null)}
        >
          {t("settings.label.coding-default-none")}
        </button>
        {harnesses.filter(pickable).map((harness) => (
          <button
            key={harness.harness_id}
            type="button"
            role="radio"
            aria-checked={harness.harness_id === value}
            className={styles.productOption}
            data-product={harness.harness_id}
            onClick={() => onChange(harness.harness_id)}
          >
            <ProductName harness={harness.harness_id} label={harness.label} />
          </button>
        ))}
      </div>
      <span className={styles.lineHelp}>
        {t("settings.note.coding-default-used")}
      </span>
    </fieldset>
  );
}

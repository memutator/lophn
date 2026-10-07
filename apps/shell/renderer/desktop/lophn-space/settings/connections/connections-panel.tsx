// coding agent 연결 자리(flow connect-coding-agent, manage-coding-access). 사람은 감지된 harness 하나를 고르고
// 이름과 범위를 정할 뿐이다. 그 선택이 허락이라 확인 창 없이 credential 발급과 설치로 이어지고, token 생성·
// 복사는 이 화면에 없다. 감지 기록·설치 위치는 펼친 자리에만 보인다. 회수만 확인 창의 결정이다.
// 재감지는 사람이 [Detect again]을 누를 때만 한다(화면이 열릴 때는 저장한 결과를 읽는다).
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  ErrorState,
  Field,
  Input,
  Loading,
  Skeleton,
  StatusMark,
} from "@lophn/design/components";
import { t } from "@lophn/wording";

import styles from "../settings.module.css";
import {
  authText,
  checkText,
  checkTone,
  connectErrorText,
  defaultLabel,
  discoveryText,
  discoveryTone,
  harnessName,
  installText,
  installTone,
  pickable,
  scopeText,
  stageText,
  validLabel,
  versionText,
} from "./model.ts";
import type {
  AppChoice,
  CodingConnectionsSource,
  ConnectionRow,
  ConnectionScope,
  ConnectView,
  DetectView,
  HarnessView,
} from "./source.ts";

export interface CodingConnectionsPanelProps {
  source: CodingConnectionsSource;
  /** `lophn://things-to-confirm/<cac id>` 링크로 온 연결. 그 줄을 먼저 보인다. */
  focus?: string;
}

type Loaded<T> =
  | { readonly state: "loading" }
  | { readonly state: "failed" }
  | { readonly state: "ready"; readonly value: T };

function useLoaded<T>(
  source: CodingConnectionsSource,
  read: () => Promise<
    { readonly ok: true; readonly value: T } | { readonly ok: false }
  >,
): [Loaded<T>, () => void, (value: T) => void] {
  const [loaded, setLoaded] = useState<Loaded<T>>({ state: "loading" });
  const load = useCallback(() => {
    void read().then((result) =>
      setLoaded(
        result.ok
          ? { state: "ready", value: result.value }
          : { state: "failed" },
      )
    );
  }, [read]);
  useEffect(() => {
    let previous: string | null = null;
    const stop = source.watch((state) => {
      if (state.state === "ready" && previous !== "ready") load();
      previous = state.state;
    });
    if (previous === null) load();
    const focus = () => load();
    globalThis.addEventListener?.("focus", focus);
    return () => {
      stop();
      globalThis.removeEventListener?.("focus", focus);
    };
  }, [source, load]);
  return [loaded, load, (value) => setLoaded({ state: "ready", value })];
}

export function CodingConnectionsPanel(
  { source, focus }: CodingConnectionsPanelProps,
) {
  const readDetect = useCallback(() => source.detect(), [source]);
  const readConnections = useCallback(() => source.connections(), [source]);
  const readApps = useCallback(() => source.apps(), [source]);
  const [detected, reloadDetect, setDetected] = useLoaded(source, readDetect);
  const [connections, reloadConnections] = useLoaded(source, readConnections);
  const [apps] = useLoaded(source, readApps);
  const appName = useMemo(() => {
    const names = new Map<string, string>(
      apps.state === "ready" ? apps.value.map((app) => [app.id, app.name]) : [],
    );
    return (id: string) => names.get(id) ?? null;
  }, [apps]);
  const [connected, setConnected] = useState<
    { readonly harness: HarnessView["harness_id"]; readonly view: ConnectView } | null
  >(null);

  return (
    <div className={styles.groups} data-coding-connections="">
      <section className={styles.section} data-section="harnesses">
        <h2 className={styles.heading}>{t("settings.heading.coding-agents")}</h2>
        <p className={styles.text}>{t("settings.note.coding-intro")}</p>
        <Harnesses
          source={source}
          detected={detected}
          apps={apps.state === "ready" ? apps.value : []}
          onDetected={setDetected}
          onRetry={reloadDetect}
          onConnected={(harness, view) => {
            setConnected({ harness, view });
            reloadConnections();
          }}
        />
        {connected === null
          ? null
          : <ConnectedResult harness={connected.harness} view={connected.view} />}
      </section>
      <section className={styles.section} data-section="connections">
        <h2 className={styles.heading}>{t("settings.heading.coding-access")}</h2>
        <Connections
          source={source}
          connections={connections}
          appName={appName}
          focus={focus}
          onReload={reloadConnections}
        />
      </section>
    </div>
  );
}

function Harnesses(
  { source, detected, apps, onDetected, onRetry, onConnected }: {
    source: CodingConnectionsSource;
    detected: Loaded<DetectView>;
    apps: readonly AppChoice[];
    onDetected: (view: DetectView) => void;
    onRetry: () => void;
    onConnected: (
      harness: HarnessView["harness_id"],
      view: ConnectView,
    ) => void;
  },
) {
  const [choosing, setChoosing] = useState<HarnessView["harness_id"] | null>(
    null,
  );
  const [refreshing, setRefreshing] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);

  async function refresh(): Promise<void> {
    setRefreshing(true);
    setRefreshFailed(false);
    const result = await source.refresh();
    setRefreshing(false);
    if (result.ok) onDetected(result.value);
    else setRefreshFailed(true);
  }

  if (detected.state === "failed") {
    return (
      <ErrorState target={t("settings.label.coding-target")} onRetry={onRetry} />
    );
  }
  return (
    <Loading
      loading={detected.state === "loading"}
      placeholder={<Skeleton lines={4} />}
    >
      {detected.state === "ready"
        ? (
          <>
            <ul className={styles.rows} data-harnesses="">
              {detected.value.harnesses.map((harness) => (
                <li
                  key={harness.harness_id}
                  className={styles.row}
                  data-harness={harness.harness_id}
                  data-discovery={harness.discovery}
                >
                  <div className={styles.rowText}>
                    <span className={styles.subheading}>
                      {harnessName(harness.harness_id)}
                    </span>
                    <span className={styles.muted}>
                      <StatusMark
                        tone={discoveryTone(harness)}
                        label={discoveryText(harness)}
                      />
                    </span>
                    {pickable(harness)
                      ? (
                        <span className={styles.muted} data-harness-facts="">
                          {versionText(harness)}
                          {" · "}
                          {authText(harness)}
                        </span>
                      )
                      : null}
                    <HarnessDetails harness={harness} />
                    {choosing === harness.harness_id
                      ? (
                        <ConnectForm
                          source={source}
                          harness={harness}
                          apps={apps}
                          onCancel={() => setChoosing(null)}
                          onConnected={(view) => {
                            setChoosing(null);
                            onConnected(harness.harness_id, view);
                          }}
                        />
                      )
                      : null}
                  </div>
                  {pickable(harness) && choosing !== harness.harness_id
                    ? (
                      <Button
                        size="sm"
                        data-action="connect-with"
                        onClick={() => setChoosing(harness.harness_id)}
                      >
                        {t("settings.button.connect-with", {
                          name: harnessName(harness.harness_id),
                        })}
                      </Button>
                    )
                    : null}
                </li>
              ))}
            </ul>
            <div className={styles.actions}>
              <Button
                size="sm"
                variant="secondary"
                data-action="detect-again"
                disabled={refreshing}
                onClick={() => void refresh()}
              >
                {t("settings.button.detect-again")}
              </Button>
            </div>
            <p className={styles.muted} data-detect-note="">
              {detected.value.source === "refreshed"
                ? t("settings.note.coding-checked-again")
                : t("settings.note.coding-detect-note")}
            </p>
            {refreshFailed
              ? (
                <p className={styles.notice} role="alert" data-detect-failed="">
                  {t("settings.error.coding-detect")}
                </p>
              )
              : null}
          </>
        )
        : null}
    </Loading>
  );
}

// 감지 기록은 기본 화면이 아니라 펼친 자리에만 보인다.
function HarnessDetails({ harness }: { harness: HarnessView }) {
  if (harness.executable === null && harness.candidates.length === 0) {
    return null;
  }
  return (
    <details data-harness-details="">
      <summary className={styles.muted}>
        {t("settings.label.coding-details")}
      </summary>
      <ul className={styles.results}>
        {harness.executable === null ? null : (
          <li className={styles.muted}>
            {t("settings.label.coding-detail-executable", {
              path: harness.executable,
            })}
          </li>
        )}
        {harness.candidates.map((candidate) => (
          <li key={candidate.path} className={styles.muted}>
            {t("settings.label.coding-detail-candidate", {
              path: candidate.path,
              source: candidate.source,
            })}
          </li>
        ))}
        {harness.probes.map((probe) => (
          <li key={probe.probe} className={styles.muted}>
            {t("settings.label.coding-detail-probe", {
              probe: probe.probe,
              outcome: probe.outcome,
            })}
          </li>
        ))}
      </ul>
    </details>
  );
}

function ConnectForm(
  { source, harness, apps, onCancel, onConnected }: {
    source: CodingConnectionsSource;
    harness: HarnessView;
    apps: readonly AppChoice[];
    onCancel: () => void;
    onConnected: (view: ConnectView) => void;
  },
) {
  const [label, setLabel] = useState(defaultLabel(harness.harness_id));
  const [oneApp, setOneApp] = useState(false);
  const [app, setApp] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const scope: ConnectionScope | null = oneApp
    ? app === null ? null : { kind: "app", app }
    : { kind: "all" };

  async function connect(): Promise<void> {
    if (scope === null || !validLabel(label)) return;
    setBusy(true);
    setFailed(null);
    const result = await source.connect({
      harness: harness.harness_id,
      label: label.trim(),
      scope,
    });
    setBusy(false);
    if (result.ok) onConnected(result.value);
    else setFailed(result.code);
  }

  return (
    <form
      className={styles.form}
      data-connect-form={harness.harness_id}
      onSubmit={(event) => {
        event.preventDefault();
        void connect();
      }}
    >
      <Field
        label={t("settings.label.connection-name")}
        help={t("settings.note.coding-name-help")}
      >
        <Input
          value={label}
          autoComplete="off"
          data-connect-name=""
          onChange={(event) => setLabel(event.currentTarget.value)}
        />
      </Field>
      <fieldset className={styles.form} data-connect-scope="">
        <legend className={styles.subheading}>
          {t("settings.label.connection-scope")}
        </legend>
        <div className={styles.actions}>
          <Button
            size="sm"
            type="button"
            variant={oneApp ? "secondary" : "primary"}
            aria-pressed={!oneApp}
            data-scope="all"
            onClick={() => setOneApp(false)}
          >
            {t("settings.label.coding-scope-all")}
          </Button>
          <Button
            size="sm"
            type="button"
            variant={oneApp ? "primary" : "secondary"}
            aria-pressed={oneApp}
            data-scope="app"
            disabled={apps.length === 0}
            onClick={() => setOneApp(true)}
          >
            {t("settings.label.coding-scope-pick-app")}
          </Button>
        </div>
        {oneApp
          ? (
            <div className={styles.actions} data-scope-apps="">
              {apps.map((choice) => (
                <Button
                  key={choice.id}
                  size="sm"
                  type="button"
                  variant={app === choice.id ? "primary" : "secondary"}
                  aria-pressed={app === choice.id}
                  data-scope-app=""
                  onClick={() => setApp(choice.id)}
                >
                  {choice.name}
                </Button>
              ))}
            </div>
          )
          : null}
        <p className={styles.muted}>
          {oneApp
            ? t("settings.note.coding-scope-app-note")
            : t("settings.note.coding-scope-all-note")}
        </p>
      </fieldset>
      <p className={styles.muted}>{t("settings.note.coding-connect-note")}</p>
      <div className={styles.actions}>
        <Button
          size="sm"
          type="submit"
          data-action="connect"
          disabled={busy || scope === null || !validLabel(label)}
        >
          {t("settings.button.connect")}
        </Button>
        <Button
          size="sm"
          type="button"
          variant="ghost"
          data-action="cancel-connect"
          onClick={onCancel}
        >
          {t("settings.button.cancel")}
        </Button>
      </div>
      {failed === null
        ? null
        : (
          <p className={styles.notice} role="alert" data-connect-failed={failed}>
            {connectErrorText(failed)}
          </p>
        )}
    </form>
  );
}

// 연결 생성·설치·loading 확인은 서로 다른 사실이다. 하나의 성공이 다른 것을 채우지 않는다.
function ConnectedResult(
  { harness, view }: { harness: HarnessView["harness_id"]; view: ConnectView },
) {
  return (
    <div className={styles.form} data-connected={view.install.status}>
      <p className={styles.notice} role="status">
        {t("settings.note.coding-connected", { name: harnessName(harness) })}
      </p>
      <p className={styles.text}>
        <StatusMark
          tone={installTone(view.install.status)}
          label={installText(view.install.status)}
        />
      </p>
      {view.checks === null
        ? (
          <p className={styles.muted} data-checks="unavailable">
            {t("settings.note.coding-checks-unavailable")}
          </p>
        )
        : (
          <ul className={styles.results} data-checks="">
            {view.checks.map((check) => (
              <li key={check.stage} data-check={check.stage}>
                <StatusMark
                  tone={checkTone(check.result)}
                  label={t("settings.label.coding-check-line", {
                    stage: stageText(check.stage),
                    result: checkText(check.result),
                  })}
                />
              </li>
            ))}
          </ul>
        )}
      <p className={styles.muted}>{t("settings.note.coding-start-note")}</p>
      {view.install.resources.length === 0 ? null : (
        <details data-install-details="">
          <summary className={styles.muted}>
            {t("settings.label.coding-install-details")}
          </summary>
          <ul className={styles.results}>
            {view.install.resources.map((resource) => (
              <li key={resource.identity} className={styles.muted}>
                {t("settings.label.coding-detail-resource", {
                  place: resource.identity,
                  outcome: resource.outcome,
                })}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function Connections(
  { source, connections, appName, focus, onReload }: {
    source: CodingConnectionsSource;
    connections: Loaded<readonly ConnectionRow[]>;
    appName: (app: string) => string | null;
    focus?: string;
    onReload: () => void;
  },
) {
  const [asked, setAsked] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  // 결정 창은 닫혀도 결정이 아니다. 창을 연 동안은 회수가 반영됐는지 다시 읽는다.
  useEffect(() => {
    if (asked === null) return;
    const timer = setInterval(onReload, 3000);
    return () => clearInterval(timer);
  }, [asked, onReload]);

  async function revoke(connection: string): Promise<void> {
    setFailed(false);
    const opened = await source.revoke(connection);
    if (opened.ok) setAsked(connection);
    else setFailed(true);
  }

  if (connections.state === "failed") {
    return (
      <ErrorState
        target={t("settings.label.coding-connections-target")}
        onRetry={onReload}
      />
    );
  }
  if (connections.state === "ready" && connections.value.length === 0) {
    return (
      <p className={styles.empty} data-connections-empty="">
        {t("settings.note.coding-no-connections")}
      </p>
    );
  }
  const rows = connections.state === "ready"
    ? [...connections.value].sort((a, b) =>
      (a.id === focus ? -1 : 0) - (b.id === focus ? -1 : 0)
    )
    : [];
  return (
    <Loading
      loading={connections.state === "loading"}
      placeholder={<Skeleton lines={3} />}
    >
      <ul className={styles.rows} data-connection-list="">
        {rows.map((row) => (
          <li
            key={row.id}
            className={styles.row}
            data-connection={row.state}
            data-focused={row.id === focus ? "" : undefined}
          >
            <div className={styles.rowText}>
              <span className={styles.subheading} data-connection-name="">
                {row.label}
              </span>
              <span className={styles.muted}>
                {scopeText(row, appName)}
                {" · "}
                {row.state === "active"
                  ? t("settings.label.coding-state-active")
                  : t("settings.label.coding-state-revoked")}
              </span>
              {row.state === "revoked"
                ? (
                  <span className={styles.muted} data-revoked-note="">
                    {t("settings.note.coding-revoked-note")}
                  </span>
                )
                : null}
              {asked === row.id && row.state === "active"
                ? (
                  <span className={styles.muted} data-revoke-waiting="">
                    {t("settings.note.coding-revoke-waiting")}
                  </span>
                )
                : null}
            </div>
            {row.state === "active"
              ? (
                <Button
                  size="sm"
                  variant="secondary"
                  data-action="revoke"
                  onClick={() => void revoke(row.id)}
                >
                  {t("settings.button.revoke")}
                </Button>
              )
              : null}
          </li>
        ))}
      </ul>
      {failed
        ? (
          <p className={styles.notice} role="alert" data-revoke-failed="">
            {t("settings.error.coding-revoke-window")}
          </p>
        )
        : null}
    </Loading>
  );
}

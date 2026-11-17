// app_preview 탭. 그 앱에서 지금 돌고 있는 preview를 앱 view(mode preview)로 보인다. 화면은 안내 줄에서 사람이 고르거나 agent가
// `--screen`으로 고른 것, 없으면 앱의 첫 `tab` 화면이다. 폰 화면은 `phone` 자리로 열고 기기가 없으면 기준 폰을 고른다. 앱마다 탭 하나이고 지금 preview를 따라간다:
// `previews.get`을 읽고 preview가 뜨고 ready가 되고 끝날 때(app_runtime 변경) 다시 읽어, process가 바뀌면 view를 새로 열고
// 없어지면 "돌고 있는 preview 없음"을 보인다.
// Annotate는 앱 화면 탭과 같은 길(use-tab-annotate.tsx)이고, 보낸 annotation은 release 대신 preview의 bundle hash를 싣는다.
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
} from "react";
import { Button } from "@lophn/ui/primitives";
import { FieldContext, Select } from "@lophn/ui/input";
import { Toast } from "@lophn/ui/overlay";
import { t } from "@lophn/i18n";

import { STAY } from "../app-frame/annotate/use-view-toast.ts";
import { useAppViews, useAppWorkspace } from "../app-frame/app-views.tsx";
import { EmbeddedView } from "../app-frame/embedded-view.tsx";
import { useWebviewHost } from "../app-frame/webview-host.tsx";
import type { AppRow, AppsSource, OpenScreen } from "../apps/source.ts";
import {
  type CoreSource,
  windowCoreSource,
} from "../desktop/connection/connection.ts";
import type { AppFrameViewState } from "../../ipc/app-frame.ts";
import { appTools } from "../../../protocol/apps/declaration/read.ts";
import { previewsGet } from "../../../protocol/apps/previews.ts";
import { devicesList } from "../../../protocol/remote/routes.ts";
import { useCoreRead } from "../desktop/connection/core-read.ts";
import type { AgentViewSlice } from "./kinds/host.ts";
import { AgentControlBar } from "../browser/browser-chrome.tsx";
import { surfaceApi, useAgentControl } from "./use-surface-requests.ts";
import { useTabAnnotate } from "./use-tab-annotate.tsx";
import styles from "./app-preview-tab.module.css";

const DEVICES_KEY = "shell.devices";
// Select의 값은 비어 있을 수 없어 Desktop에 이 값을 준다.
const DESKTOP = "::desktop";

/** 지금 돌고 있는 preview 하나. release는 없을 수 있다(bundle만 띄운 preview). */
export interface RunningPreview {
  readonly nonce: string;
  readonly release: string | null;
}

/** 사람이 Settings › Browser에 등록한 기기(설정 `shell.devices`). */
export interface PreviewDevice {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
  readonly os: "ios" | "android";
  /** pairing이 넣은 항목만 있다. 그 기기의 id다. */
  readonly device?: string;
}

export interface PreviewSource {
  /** 등록한 기기들. 못 읽으면 빈 목록이다. */
  devices(): Promise<readonly PreviewDevice[]>;
  stop(app: string, nonce: string): Promise<void>;
}

export function corePreviewSource(core: CoreSource): PreviewSource {
  return {
    async devices() {
      const reply = await core.call({
        kind: "memory",
        resource: "settings",
        method: "list",
        body: { keys: [DEVICES_KEY] },
      });
      if (!reply.ok) return [];
      const setting = (
        reply.value as {
          settings: { key: string; chosen?: unknown; default?: unknown }[];
        }
      ).settings.find((item) => item.key === DEVICES_KEY);
      // core가 설정 schema로 검사한 값이다.
      return (setting?.chosen ?? setting?.default ?? []) as PreviewDevice[];
    },
    async stop(app, nonce) {
      await core.call({
        kind: "read",
        resource: "previews",
        method: "stop",
        body: { app, process_nonce: nonce },
      });
    },
  };
}

const PreviewSourceContext = createContext<PreviewSource | null>(null);
export const PreviewSourceProvider = PreviewSourceContext.Provider;

// preload가 없는 창에서는 call이 거절되어 preview가 없는 것과 같이 보인다.
let windowSource: PreviewSource | undefined;
function usePreviewSource(): PreviewSource {
  const given = useContext(PreviewSourceContext);
  if (given !== null) return given;
  windowSource ??= corePreviewSource(windowCoreSource());
  return windowSource;
}

/** 그 앱의 preview를 따라간다. undefined는 아직 읽기 전이다. ready가 아닌 preview는 없는 것(null)으로 본다. */
export function useRunningPreview(app: string): {
  preview: RunningPreview | null | undefined;
  stop(): void;
} {
  const source = usePreviewSource();
  const read = useCoreRead(previewsGet, { app }).loaded;
  const observation =
    read.state === "ready" ? read.value.observation : undefined;
  const nonce = observation?.ready ? observation.process_nonce : null;
  const release = observation?.ready ? observation.release : null;
  // 같은 process면 같은 값을 돌려 view를 다시 열지 않는다.
  const preview = useMemo(
    () => (nonce === null ? null : { nonce, release }),
    [nonce, release],
  );
  return {
    preview: observation === undefined ? undefined : preview,
    stop() {
      // 멈춘 preview는 core가 app_runtime 변경을 내어 위 읽기가 따라간다.
      if (preview !== null) void source.stop(app, preview.nonce);
    },
  };
}

type Entry =
  | { readonly state: "loading" }
  | { readonly state: "unavailable" }
  | { readonly state: "ready"; readonly screen: OpenScreen };

interface AppPreviewTabProps {
  app: string;
  /** 탭 key. agent가 연 탭은 `host:<tab id>`다. */
  tabKey: string;
  source: AppsSource | undefined;
  shown: boolean;
  /** annotation을 받는 lophn session. 통로가 없으면 null이다. */
  agentView: AgentViewSlice | null;
  /** agent가 `--device`로 열었을 때의 기기 이름. 고른 기기는 이 탭의 state에만 있다. */
  initialDevice: string | null;
  /** 이미 열린 탭에 agent가 `--device`를 줄 때마다 달라지는 값. 0이면 준 적이 없다. */
  deviceAt: number;
  /** agent가 `--screen`으로 고른 화면 key. null이면 앱의 첫 `tab` 화면이다. */
  screen: string | null;
}

/** 등록한 기기 목록. 탭이 보일 때마다 다시 읽어 Settings에서 고친 것이 따라온다. */
function useDevices(shown: boolean): readonly PreviewDevice[] {
  const source = usePreviewSource();
  const [devices, setDevices] = useState<readonly PreviewDevice[]>([]);
  useEffect(() => {
    if (!shown) return;
    let live = true;
    void source.devices().then((list) => live && setDevices(list));
    return () => {
      live = false;
    };
  }, [source, shown]);
  return devices;
}

// 안내 줄의 이름 붙은 고르기(화면, 기기).
function NoticePicker(props: {
  label: string;
  options: readonly { value: string; label: string }[];
  value: string;
  onChange(value: string): void;
  data?: Record<string, string>;
}) {
  const id = useId();
  return (
    <FieldContext.Provider value={{ id, invalid: false }}>
      <div className={styles.device} {...props.data}>
        <label htmlFor={id} className={styles.deviceLabel}>
          {props.label}
        </label>
        <Select
          size="sm"
          options={[...props.options]}
          value={props.value}
          onValueChange={props.onChange}
        />
      </div>
    </FieldContext.Provider>
  );
}

function DevicePicker(props: {
  devices: readonly PreviewDevice[];
  value: string | null;
  onChange(name: string | null): void;
}) {
  return (
    <NoticePicker
      label={t("app-space.label.preview-device")}
      options={[
        { value: DESKTOP, label: t("app-space.option.device-desktop") },
        ...props.devices.map((d) => ({ value: d.name, label: d.name })),
      ]}
      value={props.value ?? DESKTOP}
      onChange={(next) => props.onChange(next === DESKTOP ? null : next)}
    />
  );
}

/** 그 release가 preview로 여는 화면(`tab`·`phone` 자리). 못 읽었으면 빈 목록이다. */
function usePreviewScreens(
  app: string,
  release: string | null,
): readonly { key: string; label: string; tab: boolean; phone: boolean }[] {
  const read = useCoreRead(appTools, {
    app,
    ...(release === null ? {} : { release }),
  }).loaded;
  if (read.state !== "ready" || read.value.release !== release) return [];
  return read.value.screens.flatMap((screen) =>
    screen.places.includes("phone") || screen.places.includes("tab")
      ? [
          {
            key: screen.key,
            label: screen.label,
            tab: screen.places.includes("tab"),
            phone: screen.places.includes("phone"),
          },
        ]
      : [],
  );
}

/** 기준 폰(짝지은 기기 가운데 primary)의 `shell.devices` 항목 이름. agent의 `--screen`과 같은 규칙이다. */
function useReferencePhone(devices: readonly PreviewDevice[]): string | null {
  const read = useCoreRead(devicesList, {}).loaded;
  const primary =
    read.state === "ready"
      ? read.value.devices.find((item) => item.primary)
      : undefined;
  return (
    devices.find((item) => primary !== undefined && item.device === primary.id)
      ?.name ?? null
  );
}

export function AppPreviewTab(props: AppPreviewTabProps) {
  const { app, source, shown, agentView } = props;
  // 사람이 안내 줄에서 고른 화면. agent가 `--screen`을 다시 주면 그것을 따른다.
  const [screen, setScreen] = useState<string | null>(props.screen);
  useEffect(() => setScreen(props.screen), [props.screen]);
  const deps = useAppViews();
  const workspace = useAppWorkspace();
  const { preview, stop } = useRunningPreview(app);
  const devices = useDevices(shown);
  const [chosen, setChosen] = useState<string | null>(props.initialDevice);
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    if (props.deviceAt === 0) return;
    setBlocked(false);
    setChosen(props.initialDevice);
  }, [props.deviceAt, props.initialDevice]);
  const reference = useReferencePhone(devices);
  const [row, setRow] = useState<AppRow | null>(null);
  const [entry, setEntry] = useState<Entry>({ state: "loading" });
  const [state, setState] = useState<AppFrameViewState | null>(null);

  useEffect(() => {
    if (source === undefined) return;
    let live = true;
    void source.get(app).then((result) => {
      if (live && result.ok) setRow(result.value);
    });
    return () => {
      live = false;
    };
  }, [source, app]);

  // 화면은 그 release의 선언에서 읽는다. release 없는 preview는 어느 화면을 열지 알 수 없다.
  const release = preview?.release ?? null;
  const screens = usePreviewScreens(app, release);
  // 기본은 첫 `tab` 화면이다. 폰 화면만 가진 앱은 그것이 없어 빈 탭이 되므로 첫 폰 화면을 연다.
  const phoneOnly =
    screens.length > 0 && !screens.some((item) => item.tab)
      ? screens[0]!.key
      : null;
  useEffect(() => {
    if (screen === null && phoneOnly !== null) setScreen(phoneOnly);
  }, [screen, phoneOnly]);
  useEffect(() => {
    setEntry({ state: "loading" });
    if (source === undefined || release === null) return;
    let live = true;
    void source
      .screenToOpen(app, release, screen ?? undefined)
      .then((found) => {
        if (live) {
          setEntry(
            found.ok
              ? { state: "ready", screen: found.value }
              : { state: "unavailable" },
          );
        }
      });
    return () => {
      live = false;
    };
  }, [source, app, release, preview?.nonce, screen]);

  // 폰 화면을 넓은 desktop 틀에 그리면 잘못 믿게 된다. 기기를 고르지 않았으면 기준 폰으로 연다(agent의 `--screen`과 같다).
  const onPhone = entry.state === "ready" && entry.screen.place === "phone";
  const device =
    devices.find((d) => d.name === chosen) ??
    (chosen === null && onPhone && !blocked
      ? (devices.find((d) => d.name === reference) ?? null)
      : null);

  // 고른 기기를 main에서 그 view에 건다. view가 새로 열리면(다른 preview process) 새 view에 다시 건다.
  const surface = surfaceApi();
  const viewSession = state?.view_session ?? null;
  const spec =
    device === null
      ? null
      : {
          width: device.width,
          height: device.height,
          dpr: device.dpr,
          os: device.os,
        };
  const specKey = spec === null ? "" : JSON.stringify(spec);
  useEffect(() => {
    if (surface === null || viewSession === null) return;
    let live = true;
    void surface
      .emulate({ view_session: viewSession, device: spec })
      .then((result) => {
        if (!live || result.ok) return;
        // DevTools가 열려 못 걸면 Desktop으로 돌아가 사람이 DevTools를 닫고 다시 고르게 한다.
        if (result.reason !== "devtools") return;
        setBlocked(true);
        setChosen(null);
      });
    return () => {
      live = false;
    };
  }, [surface, viewSession, specKey]);

  const agent = useAgentControl(props.tabKey, state?.view_session ?? null);
  // agent가 다루는 동안은 가려져도 그리기를 이어 간다. view의 element key가 view session이다.
  const webviews = useWebviewHost();
  const drivenKey = state?.view_session ?? null;
  const driven = agent !== null;
  useEffect(() => {
    if (webviews === null || drivenKey === null) return;
    webviews.setDriven(drivenKey, driven);
    return () => webviews.setDriven(drivenKey, false);
  }, [webviews, drivenKey, driven]);
  const { shellHead, toast } = useTabAnnotate({
    viewSession: state?.view_session ?? null,
    target: row?.name ?? "",
    agentView,
  });

  let body;
  if (preview === undefined) body = null;
  else if (preview === null) {
    body = <p className={styles.state}>{t("app-space.empty.no-preview")}</p>;
  } else if (entry.state === "unavailable") {
    body = (
      <p className={styles.state}>{t("app-space.empty.screen-not-ready")}</p>
    );
  } else if (entry.state === "ready" && deps !== null) {
    body = (
      <EmbeddedView
        key={`${preview.nonce}:${entry.screen.key}`}
        views={deps.views}
        app={app}
        mode="preview"
        release={preview.release}
        screen={entry.screen.key}
        place={entry.screen.place}
        workspace={workspace}
        label={row?.name ?? ""}
        shown={shown}
        tabHead
        {...(shellHead === undefined ? {} : { shellHead })}
        onState={setState}
      />
    );
  }

  return (
    <div className={styles.tab} data-app-preview={app}>
      <div className={styles.notice} data-preview-notice="">
        <span className={styles.text}>
          {blocked
            ? t("app-space.error.device-devtools")
            : t("app-space.text.preview-notice")}
        </span>
        {screens.length < 2 ? null : (
          <NoticePicker
            label={t("app-space.label.preview-screen")}
            options={screens.map((item) => ({
              value: item.key,
              label: item.phone
                ? t("app-space.option.screen-phone", { screen: item.label })
                : item.label,
            }))}
            value={
              screen ??
              (entry.state === "ready" ? entry.screen.key : screens[0]!.key)
            }
            onChange={setScreen}
            data={{ "data-preview-screen": "" }}
          />
        )}
        <DevicePicker
          devices={devices}
          value={device === null ? null : device.name}
          onChange={(name) => {
            setBlocked(false);
            setChosen(name);
          }}
        />
        {agent === null ? null : <AgentControlBar control={agent} />}
        <Button
          size="sm"
          variant="ghost"
          disabled={preview === null || preview === undefined}
          data-preview-stop=""
          onClick={stop}
        >
          {t("app-space.button.stop-preview")}
        </Button>
      </div>
      <div
        className={device === null ? styles.view : styles.stage}
        data-preview-device={device === null ? undefined : device.name}
      >
        {/* 같은 자리에 두어 기기를 바꿔도 view를 다시 열지 않는다. */}
        <div
          className={device === null ? styles.full : styles.phone}
          {...(device === null
            ? {}
            : { style: { width: device.width, height: device.height } })}
        >
          {body}
        </div>
        {toast.dom === null ? null : (
          <div className={styles.toast} data-view-toast="">
            <Toast
              title={toast.dom.title}
              {...(toast.dom.body === undefined
                ? {}
                : { body: toast.dom.body })}
              actions={
                toast.dom.action
                  ? [{ id: "act", label: toast.dom.action.label }]
                  : []
              }
              onAction={() => toast.dom?.action?.run()}
              onClose={toast.hide}
              timer={STAY}
            />
          </div>
        )}
      </div>
    </div>
  );
}

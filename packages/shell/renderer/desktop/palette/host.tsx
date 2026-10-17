// 창 하나의 팔레트 자리. Desktop이 hub를 만들고 지금 공간(작업대·Settings)이 자기
// scope를 등록한다. 창 shortcut은 main이 보낸 이름으로만 받는다.
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { IconButton, Kbd } from "@lophn/ui/primitives";
import { Tooltip } from "@lophn/ui/overlay";
import { systemTimer, type Timer } from "@lophn/ui/shared";
import { paletteIcons } from "../../icons/mod.ts";
import { t } from "@lophn/wording";

import type { OverlayApi } from "../../../ipc/overlay.ts";
import type { ShortcutApi } from "../../../ipc/shortcuts.ts";
import { currentPlatform, type WindowPlatform } from "../top-bar/platform.ts";
import { windowShortcutLabel } from "./labels.ts";
import type { FileFound } from "./model.ts";
import {
  type PaletteOpener,
  paletteOpener,
  type PaletteScope,
} from "./session.ts";
import styles from "./palette.module.css";

/** project 키워드 검색. place가 있으면 그 project에서만, 없으면 모든 project에서 찾는다. */
export type FileSearch = (
  query: string,
  place: { readonly kind: "project"; readonly id: string } | null,
) => Promise<readonly FileFound[]>;

export interface PaletteDeps {
  readonly overlay: OverlayApi;
  readonly shortcuts: ShortcutApi;
  readonly search?: FileSearch;
  readonly timer?: Timer;
  readonly platform?: WindowPlatform;
}

interface PaletteHub {
  register(scope: PaletteScope<unknown>): () => void;
  toggle(opener: HTMLElement): void;
  /**
   * 전역 팔레트. 지금 공간과 상관없이 받은 scope로 연다. 이미 열려 있으면 그대로
   * 둔다(여닫는 창 팔레트와 다르다).
   */
  openGlobal(scope: PaletteScope<unknown>): void;
  readonly platform: WindowPlatform;
  readonly search?: FileSearch;
  /** overlay·shortcut 통로가 있어 팔레트를 열 수 있다. */
  readonly available: boolean;
}

const PaletteContext = createContext<PaletteHub | null>(null);

function activeElement(): HTMLElement {
  const active = globalThis.document?.activeElement;
  return active instanceof HTMLElement ? active : document.body;
}

/**
 * Desktop이 창마다 하나 둔다. 팔레트 키는 지금 공간의 scope를 열고, 런처 복귀 키는
 * onLauncher를 부른다. scope가 없는 곳(런처)에서 팔레트 키는 아무것도 열지 않는다.
 */
export function PaletteProvider(
  { deps, onLauncher, children }: {
    deps: PaletteDeps | undefined;
    onLauncher: () => void;
    children: ReactNode;
  },
) {
  const scopes = useRef<PaletteScope<unknown>[]>([]);
  const opener = useRef<PaletteOpener | null>(null);
  const launcher = useRef(onLauncher);
  launcher.current = onLauncher;
  const platform = deps?.platform ?? currentPlatform();
  const search = deps?.search;
  const available = deps !== undefined;
  const hub = useMemo<PaletteHub>(() => ({
    platform,
    search,
    available,
    register(scope) {
      scopes.current = [...scopes.current, scope];
      return () => {
        scopes.current = scopes.current.filter((item) => item !== scope);
      };
    },
    toggle(element) {
      const current = opener.current;
      const scope = scopes.current.at(-1);
      if (!current) return;
      if (current.open || scope) void current.toggle(scope!, element);
    },
    openGlobal(scope) {
      const current = opener.current;
      if (!current || current.open) return;
      void current.toggle(scope, activeElement());
    },
  }), [platform, search, available]);
  // 통로가 있을 때만 연다. 창이 닫히면 열린 팔레트와 shortcut 구독을 함께 놓는다.
  useEffect(() => {
    if (!deps) return;
    const created = paletteOpener(deps.overlay, {
      timer: deps.timer ?? systemTimer,
    });
    opener.current = created;
    const release = deps.shortcuts.subscribe((shortcut) => {
      if (shortcut === "palette") hub.toggle(activeElement());
      else launcher.current();
    });
    return () => {
      release();
      created.dispose();
      if (opener.current === created) opener.current = null;
    };
  }, [deps, hub]);
  return (
    <PaletteContext.Provider value={hub}>{children}</PaletteContext.Provider>
  );
}

/**
 * 공간이 자기 팔레트 행을 내놓는다. build는 그릴 때마다 새로 만들어도 되고, 팔레트는
 * 열 때와 검색어가 바뀔 때 가장 최근 build를 쓴다.
 */
export function usePaletteScope<T>(build: () => PaletteScope<T>): void {
  const hub = useContext(PaletteContext);
  const latest = useRef(build);
  latest.current = build;
  useEffect(() => {
    if (!hub) return;
    const scope: PaletteScope<unknown> = {
      get title() {
        return latest.current().title;
      },
      get order() {
        return latest.current().order;
      },
      entries: () => latest.current().entries(),
      search: (query) => {
        const current = latest.current();
        return current.search ? current.search(query) : Promise.resolve([]);
      },
      choose: (target) => latest.current().choose(target as T),
    };
    return hub.register(scope);
  }, [hub]);
}

/** 전역 팔레트를 여는 함수. 팔레트가 없는 창에서는 아무것도 하지 않는다. */
export function useGlobalPalette(): (scope: PaletteScope<unknown>) => void {
  const hub = useContext(PaletteContext);
  return (scope) => hub?.openGlobal(scope);
}

/** 이 창에 팔레트가 있는지, 지금 OS(키 이름)와 파일 검색. 공간의 scope가 쓴다. */
export function usePaletteEnv(): {
  available: boolean;
  platform: WindowPlatform;
  search?: FileSearch;
} {
  const hub = useContext(PaletteContext);
  return {
    available: hub?.available ?? false,
    platform: hub?.platform ?? currentPlatform(),
    search: hub?.search,
  };
}

// 상단 바의 팔레트 열기. 이름은 tooltip과 aria-label이고 키를 같이 보인다.
export function PaletteButton() {
  const hub = useContext(PaletteContext);
  if (!hub?.available) return null;
  const label = t("common.button.palette-open");
  const keys = windowShortcutLabel("palette", hub.platform);
  return (
    <Tooltip
      content={
        <span className={styles.tip}>
          {label}
          <Kbd keys={[keys]} />
        </span>
      }
    >
      <IconButton
        icon={paletteIcons.search}
        label={label}
        data-palette-open=""
        onClick={(event) => hub.toggle(event.currentTarget)}
      />
    </Tooltip>
  );
}

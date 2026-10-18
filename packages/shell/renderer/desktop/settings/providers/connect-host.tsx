import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { AgentsSettingsSource } from "../agents/settings-source.ts";
import { ConnectProviderDialog } from "./available-list.tsx";
import { ConnectDialog } from "./connect-dialog.tsx";
import { DefaultModelDialog } from "./default-model-dialog.tsx";
import type {
  ProviderDefinitionRow,
  ProviderSettingsSource,
} from "./settings-source.ts";

export type ConnectProviderApi = {
  // Connect provider 대화창을 연다. 연결이 끝나면 새로 생긴 provider id(찾지 못하면 null)로 onConnected를 부른다.
  open(options?: { onConnected?: (providerId: string | null) => void }): void;
};

export const ConnectProviderContext = createContext<ConnectProviderApi | null>(
  null,
);

/** host 밖이면 null. */
export function useConnectProvider(): ConnectProviderApi | null {
  return useContext(ConnectProviderContext);
}

// 연결 하나가 끝난 뒤의 뒤처리(새 provider 찾기, 기본 model 고르게 하기)를 host가 맡는다. 인자는 연결하기 전에 있던 provider id들이다.
const AfterConnectContext = createContext<(before: readonly string[]) => void>(
  () => {},
);

/** Settings → Providers 화면이 자기 ConnectDialog 뒤에 부른다. host 밖이면 아무 일도 하지 않는다. */
export function useAfterConnect(): (before: readonly string[]) => void {
  return useContext(AfterConnectContext);
}

interface ConnectProviderHostProps {
  providers: ProviderSettingsSource;
  agents: AgentsSettingsSource;
  children: ReactNode;
}

// 정의 고르기 → ConnectDialog는 open()으로 열고, 끝난 뒤에는 새 provider를 찾아 알리고 전역 기본 model이 없으면
// 고르게 한다. key 연결은 보호 창이 따로 끝내므로 ConnectDialog가 끝났을 때는 아직 연결이 없을 수 있다: 그러면 창이 다시 focus를
// 받을 때 한 번만 더 읽고, 그래도 없으면 null로 끝낸다.
export function ConnectProviderHost(
  { providers, agents, children }: ConnectProviderHostProps,
): ReactNode {
  const [choosing, setChoosing] = useState(false);
  const [target, setTarget] = useState<ProviderDefinitionRow | null>(null);
  const [pickDefault, setPickDefault] = useState(false);
  // open()으로 연 연결의 상태. 정의 고르기 전에 있던 provider id와 알릴 곳.
  const opened = useRef<{
    before: readonly string[] | null;
    onConnected?: (providerId: string | null) => void;
  }>({ before: null });
  const stopWaiting = useRef<(() => void) | null>(null);
  useEffect(() => () => stopWaiting.current?.(), []);

  const newProvider = useCallback(
    async (before: readonly string[]): Promise<string | null> => {
      const read = await providers.connected();
      if (!read.ok) return null;
      return read.value.find((row) => !before.includes(row.id))?.id ?? null;
    },
    [providers],
  );

  const settle = useCallback(
    async (
      id: string | null,
      onConnected?: (providerId: string | null) => void,
    ): Promise<void> => {
      onConnected?.(id);
      if (id === null) return;
      const view = await agents.read();
      if (view.ok && view.value.defaultModel === null) setPickDefault(true);
    },
    [agents],
  );

  const afterConnect = useCallback(
    (
      before: readonly string[],
      onConnected?: (providerId: string | null) => void,
    ): void => {
      stopWaiting.current?.();
      void (async () => {
        const found = await newProvider(before);
        if (found !== null) return settle(found, onConnected);
        const retry = () => {
          stopWaiting.current = null;
          void newProvider(before).then((id) => settle(id, onConnected));
        };
        globalThis.addEventListener?.("focus", retry, { once: true });
        stopWaiting.current = () =>
          globalThis.removeEventListener?.("focus", retry);
      })();
    },
    [newProvider, settle],
  );

  const api = useMemo<ConnectProviderApi>(() => ({
    open(options) {
      opened.current = { before: null, onConnected: options?.onConnected };
      void providers.connected().then((read) => {
        opened.current.before = read.ok
          ? read.value.map((row) => row.id)
          : null;
      });
      setChoosing(true);
    },
  }), [providers]);

  return (
    <ConnectProviderContext.Provider value={api}>
      <AfterConnectContext.Provider value={afterConnect}>
        {children}
        {choosing
          ? (
            <ConnectProviderDialog
              source={providers}
              onChoose={(definition) => {
                setChoosing(false);
                setTarget(definition);
              }}
              onClose={() => setChoosing(false)}
            />
          )
          : null}
        <ConnectDialog
          source={providers}
          definition={target}
          onClose={() => setTarget(null)}
          onConnected={() => {
            const { before, onConnected } = opened.current;
            // 고르기 전 목록을 읽지 못했으면 무엇이 새것인지 알 수 없다.
            if (before === null) onConnected?.(null);
            else afterConnect(before, onConnected);
          }}
        />
        {pickDefault
          ? (
            <DefaultModelDialog
              agents={agents}
              onClose={() => setPickDefault(false)}
            />
          )
          : null}
      </AfterConnectContext.Provider>
    </ConnectProviderContext.Provider>
  );
}

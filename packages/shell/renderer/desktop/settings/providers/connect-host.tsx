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

import { t } from "@lophn/i18n";

import type { ManageModelsApi } from "../../../conversation/model-picker/manage-context.ts";
import type { AgentsSettingsSource } from "../agents/settings-source.ts";
import { ConnectProviderDialog } from "./available-list.tsx";
import { ConnectDialog } from "./connect-dialog.tsx";
import { DefaultModelDialog } from "./default-model-dialog.tsx";
import { ManageModelsHost } from "./manage-models-host.tsx";
import type {
  ProviderDefinitionRow,
  ProviderSettingsSource,
} from "./settings-source.ts";

export type ConnectProviderApi = {
  // Connect provider 대화창을 연다. 연결이 끝나면 새로 생긴 provider id(찾지 못하면 null)로 onConnected를 부른다.
  // custom provider의 목록을 읽어 찾았으면 notice에 그 한 줄이 온다(다른 창이 이미 보였으면 없다).
  open(options?: {
    onConnected?: (providerId: string | null, notice?: string) => void;
  }): void;
};

export const ConnectProviderContext = createContext<ConnectProviderApi | null>(
  null,
);

/** host 밖이면 null. */
export function useConnectProvider(): ConnectProviderApi | null {
  return useContext(ConnectProviderContext);
}

/** custom provider의 목록을 읽은 결과. count가 0이면 목록이 없다. */
export type ListedModels = { name: string; count: number };

// 연결 하나가 끝난 뒤의 뒤처리(새 provider 찾기, 기본 model 고르게 하기)를 host가 맡는다. 인자는 연결하기 전에 있던 provider id들이고,
// onListed는 custom provider의 목록을 읽은 결과를 받는다.
type AfterConnect = (
  before: readonly string[],
  onListed?: (providerId: string, listed: ListedModels) => void,
) => void;
const AfterConnectContext = createContext<AfterConnect>(() => {});

/** Settings → Providers 화면이 자기 ConnectDialog 뒤에 부른다. host 밖이면 아무 일도 하지 않는다. */
export function useAfterConnect(): AfterConnect {
  return useContext(AfterConnectContext);
}

interface ConnectProviderHostProps {
  providers: ProviderSettingsSource;
  agents: AgentsSettingsSource;
  children: ReactNode;
}

// 정의 고르기 → ConnectDialog는 open()으로 열고, 끝난 뒤에는 새 provider를 찾는다. custom provider면 model 목록을
// 한 번 읽는다: 찾았으면 한 줄("N개 찾음")을 다음에 뜨는 창에 보이고(Settings → Providers는 읽은 결과를 onListed로도 받아 그 줄에 보인다), 목록이 없으면 그 provider의 Add model form과 함께
// Manage models를 먼저 연다. 그다음 전역 기본 model이 없으면 고르게 한다. key 연결은 보호 창이 따로 끝내므로 ConnectDialog가 끝났을 때는 아직 연결이 없을 수 있다: 그러면 창이 다시 focus를
// 받을 때 한 번만 더 읽고, 그래도 없으면 null로 끝낸다.
export function ConnectProviderHost({
  providers,
  agents,
  children,
}: ConnectProviderHostProps): ReactNode {
  const [choosing, setChoosing] = useState(false);
  const [target, setTarget] = useState<ProviderDefinitionRow | null>(null);
  const [pickDefault, setPickDefault] = useState(false);
  // open()으로 연 연결의 상태. 정의 고르기 전에 있던 provider id와 알릴 곳.
  const opened = useRef<{
    before: readonly string[] | null;
    onConnected?: (providerId: string | null, notice?: string) => void;
  }>({ before: null });
  // 기본 model 대화창 안 한 줄(custom provider의 목록을 읽은 결과).
  const [defaultNotice, setDefaultNotice] = useState<string | null>(null);
  const afterDefault = useRef<(() => void) | null>(null);
  const manage = useRef<ManageModelsApi | null>(null);
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

  // custom provider면 목록을 한 번 읽는다. 내장 provider는 null이다.
  const readList = useCallback(
    async (id: string): Promise<ListedModels | null> => {
      const read = await agents.editor.models();
      const provider = read.ok
        ? read.value.providers.find((item) => item.id === id)
        : undefined;
      if (provider === undefined || !provider.custom) return null;
      const refreshed = await agents.editor.refreshModels(id);
      const after = refreshed ? await agents.editor.models() : null;
      const count = after?.ok
        ? (after.value.providers.find((item) => item.id === id)?.reportedModels
            ?.length ?? 0)
        : 0;
      return { name: provider.name, count };
    },
    [agents],
  );

  const chooseDefault = useCallback(
    async (
      id: string,
      onConnected?: (providerId: string | null, notice?: string) => void,
      notice?: string,
    ): Promise<void> => {
      const view = await agents.read();
      if (view.ok && view.value.defaultModel === null) {
        // 대화창과 picker가 한꺼번에 뜨지 않게 대화창이 닫힌 뒤에 알린다. 한 줄은 이 대화창이 보인다.
        afterDefault.current = () => onConnected?.(id);
        setDefaultNotice(notice ?? null);
        setPickDefault(true);
        return;
      }
      onConnected?.(id, notice);
    },
    [agents],
  );

  const settle = useCallback(
    async (
      id: string | null,
      onConnected?: (providerId: string | null, notice?: string) => void,
      onListed?: (providerId: string, listed: ListedModels) => void,
    ): Promise<void> => {
      if (id === null) return onConnected?.(null);
      const listed = await readList(id);
      if (listed !== null) onListed?.(id, listed);
      if (listed !== null && listed.count === 0) {
        // 목록이 없으면 이름으로 더하게 한다. Manage models가 이미 landing을 정하므로 onConnected는 부르지 않는다.
        manage.current?.open({
          first: id,
          addModel: {
            provider: id,
            lead: t("conversation.notice.models-not-listed", {
              provider: listed.name,
            }),
          },
          onClosed: () => void chooseDefault(id),
        });
        return;
      }
      const notice =
        listed === null
          ? undefined
          : t("conversation.notice.models-found", {
              count: listed.count,
              provider: listed.name,
            });
      return chooseDefault(id, onConnected, notice);
    },
    [readList, chooseDefault],
  );

  const afterConnect = useCallback(
    (
      before: readonly string[],
      onConnected?: (providerId: string | null, notice?: string) => void,
      onListed?: (providerId: string, listed: ListedModels) => void,
    ): void => {
      stopWaiting.current?.();
      void (async () => {
        const found = await newProvider(before);
        if (found !== null) return settle(found, onConnected, onListed);
        const retry = () => {
          stopWaiting.current = null;
          void newProvider(before).then((id) =>
            settle(id, onConnected, onListed),
          );
        };
        globalThis.addEventListener?.("focus", retry, { once: true });
        stopWaiting.current = () =>
          globalThis.removeEventListener?.("focus", retry);
      })();
    },
    [newProvider, settle],
  );

  const api = useMemo<ConnectProviderApi>(
    () => ({
      open(options) {
        opened.current = { before: null, onConnected: options?.onConnected };
        void providers.connected().then((read) => {
          opened.current.before = read.ok
            ? read.value.map((row) => row.id)
            : null;
        });
        setChoosing(true);
      },
    }),
    [providers],
  );

  return (
    <ConnectProviderContext.Provider value={api}>
      <AfterConnectContext.Provider
        value={(before, onListed) => afterConnect(before, undefined, onListed)}
      >
        <ManageModelsHost source={agents.editor} apiRef={manage}>
          {children}
        </ManageModelsHost>
        {choosing ? (
          <ConnectProviderDialog
            source={providers}
            onChoose={(definition) => {
              setChoosing(false);
              setTarget(definition);
            }}
            onClose={() => setChoosing(false)}
          />
        ) : null}
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
        {pickDefault ? (
          <DefaultModelDialog
            agents={agents}
            notice={defaultNotice ?? undefined}
            onClose={() => {
              setPickDefault(false);
              const done = afterDefault.current;
              afterDefault.current = null;
              done?.();
            }}
          />
        ) : null}
      </AfterConnectContext.Provider>
    </ConnectProviderContext.Provider>
  );
}

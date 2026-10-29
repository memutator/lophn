import {
  type MutableRefObject,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { setShown } from "../../../../../protocol/lophn-agent/model-picker.ts";
import {
  type ManageModelsApi,
  ManageModelsContext,
  type ManageModelsOptions,
} from "../../../conversation/model-picker/manage-context.ts";
import { ManageModelsDialog } from "../../../conversation/model-picker/manage-models.tsx";
import type { ModelInfoOutcome } from "../../../conversation/model-picker/model-info-form.tsx";
import type { ManageProviderView } from "../../../conversation/model-picker/types.ts";
import { manageProviders } from "../../../workspace/agents/model-picker-data.ts";
import type {
  AgentsSource,
  ShownModel,
  ModelsView,
  UserModels,
} from "../../../workspace/agents/source.ts";
import { useConnectProvider } from "./connect-host.tsx";

type ManageSource = Pick<
  AgentsSource,
  | "models"
  | "refreshModels"
  | "setShown"
  | "userModels"
  | "saveModelInfo"
  | "removeModelInfo"
>;

interface ManageModelsHostProps {
  source: ManageSource;
  /** 연결 host가 창을 직접 열 수 있게 api를 담아 준다(provider를 붙인 뒤 Add model form과 함께 열기). */
  apiRef?: MutableRefObject<ManageModelsApi | null>;
  children: ReactNode;
}

// picker의 Manage models 줄이 여는 창 하나를 화면 전체 위에 둔다. 자료는 열 때와 바꿀 때마다 source에서 읽는다.
// 끄고 켜는 일은 쓰는 사이에 목록이 어긋나지 않게 하나씩 차례로 보낸다. 연결 대화창은 이 창을 닫지 않고 그 위에 열고,
// 연결이 끝나면 새 provider의 묶음을 맨 위에 보인다. 열 때마다 창을 새로 세운다(key): 열 때 정한 form이 이미 열린 창에도 서게 한다.
export function ManageModelsHost({
  source,
  apiRef,
  children,
}: ManageModelsHostProps): ReactNode {
  const connect = useConnectProvider();
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<ModelsView | null>(null);
  const [user, setUser] = useState<UserModels | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [first, setFirst] = useState<string | null>(null);
  const [landing, setLanding] = useState<
    Pick<ManageModelsOptions, "notice" | "addModel"> & { key: number }
  >({ key: 0 });
  const closed = useRef<(() => void) | undefined>(undefined);
  const shown = useRef<readonly ShownModel[]>([]);
  // 저장·지우기의 compare 기준: 마지막으로 읽은 model 정보의 판.
  const userSeq = useRef("");
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  const load = useCallback(async (): Promise<void> => {
    const [read, readUser] = await Promise.all([
      source.models(),
      source.userModels(),
    ]);
    if (!alive.current) return;
    if (!read.ok || !readUser.ok) {
      setLoadFailed(true);
      return;
    }
    setLoadFailed(false);
    shown.current = read.value.shown;
    userSeq.current = readUser.value.seq;
    setModels(read.value);
    setUser(readUser.value);
  }, [source]);

  const api = useMemo<ManageModelsApi>(
    () => ({
      open(options) {
        setFirst(options?.first ?? null);
        setLanding((now) => ({
          key: now.key + 1,
          notice: options?.notice,
          addModel: options?.addModel,
        }));
        closed.current = options?.onClosed;
        setOpen(true);
        void load();
      },
    }),
    [load],
  );
  if (apiRef !== undefined) apiRef.current = api;

  const change = (
    targets: readonly { provider: string; model_name: string }[],
    show: boolean,
  ) => {
    queue.current = queue.current.then(async () => {
      const next = setShown(shown.current, targets, show);
      shown.current = next;
      setModels((now) => (now === null ? now : { ...now, shown: next }));
      const written = await source.setShown(next);
      // 저장하지 못하면 core에 있는 값으로 되돌린다.
      if (!written.ok) await load();
    });
  };

  // 저장이나 지우기가 끝나면 catalog의 user 층도 바뀌므로 둘 다 다시 읽는다. 판이 어긋났으면 읽은 값으로 form을 이어 가게 한다.
  const changeInfo = async (
    provider: string,
    change: (definition: string) => ReturnType<AgentsSource["saveModelInfo"]>,
  ): Promise<ModelInfoOutcome> => {
    const definition = models?.providers.find(
      (item) => item.id === provider,
    )?.definition;
    if (definition === undefined) return "failed";
    const changed = await change(definition);
    if (changed.ok || changed.message === "conflict") await load();
    if (changed.ok) return "saved";
    return changed.message === "conflict" ? "conflict" : "failed";
  };

  const providers: ManageProviderView[] | null =
    models === null || user === null
      ? null
      : manageProviders(models, user, first);
  const modelsOf = (provider: string) =>
    providers?.find((item) => item.id === provider)?.models ?? [];

  return (
    <ManageModelsContext.Provider value={api}>
      {children}
      {open ? (
        <ManageModelsDialog
          key={landing.key}
          providers={providers}
          notice={landing.notice}
          initialForm={landing.addModel}
          loadFailed={loadFailed}
          onClose={() => {
            setOpen(false);
            const done = closed.current;
            closed.current = undefined;
            done?.();
          }}
          onConnect={() =>
            connect?.open({
              onConnected: (id, notice) => {
                setFirst(id);
                setLanding((now) => ({ key: now.key, notice }));
                void load();
              },
            })
          }
          onToggleModel={(provider, modelName, show) =>
            change([{ provider, model_name: modelName }], show)
          }
          onToggleProvider={(provider, show) =>
            change(
              modelsOf(provider).map((model) => ({
                provider,
                model_name: model.modelName,
              })),
              show,
            )
          }
          onRefresh={async (provider) => {
            const refreshed = await source.refreshModels(provider);
            if (refreshed) await load();
            return refreshed;
          }}
          onSaveInfo={(provider, modelName, info) =>
            changeInfo(provider, (definition) =>
              source.saveModelInfo(
                {
                  provider_definition: definition,
                  model_name: modelName,
                  info,
                },
                userSeq.current,
              ),
            )
          }
          onRemoveInfo={(provider, modelName) =>
            changeInfo(provider, (definition) =>
              source.removeModelInfo(
                {
                  provider_definition: definition,
                  model_name: modelName,
                },
                userSeq.current,
              ),
            )
          }
        />
      ) : null}
    </ManageModelsContext.Provider>
  );
}

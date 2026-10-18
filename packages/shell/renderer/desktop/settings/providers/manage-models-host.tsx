import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { setHidden } from "../../../../../protocol/lophn-agent/model-picker.ts";
import { ManageModelsContext } from "../../../conversation/model-picker/manage-context.ts";
import { ManageModelsDialog } from "../../../conversation/model-picker/manage-models.tsx";
import type { ModelInfoOutcome } from "../../../conversation/model-picker/model-info-form.tsx";
import type { ManageProviderView } from "../../../conversation/model-picker/types.ts";
import { manageProviders } from "../../../workspace/agents/model-picker-data.ts";
import type {
  AgentsSource,
  HiddenModel,
  ModelsView,
  UserModels,
} from "../../../workspace/agents/source.ts";
import { useConnectProvider } from "./connect-host.tsx";

type ManageSource = Pick<
  AgentsSource,
  | "models"
  | "refreshModels"
  | "setHidden"
  | "userModels"
  | "saveModelInfo"
  | "removeModelInfo"
>;

interface ManageModelsHostProps {
  source: ManageSource;
  children: ReactNode;
}

// picker의 Manage models 줄이 여는 창 하나를 화면 전체 위에 둔다. 자료는 열 때와 바꿀 때마다 source에서 읽는다.
// 끄고 켜는 일은 쓰는 사이에 목록이 어긋나지 않게 하나씩 차례로 보낸다. 연결 대화창은 이 창을 닫지 않고 그 위에 열고,
// 연결이 끝나면 새 provider의 묶음을 맨 위에 보인다.
export function ManageModelsHost(
  { source, children }: ManageModelsHostProps,
): ReactNode {
  const connect = useConnectProvider();
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<ModelsView | null>(null);
  const [user, setUser] = useState<UserModels | null>(null);
  const [first, setFirst] = useState<string | null>(null);
  const hidden = useRef<readonly HiddenModel[]>([]);
  // 저장·지우기의 compare 기준: 마지막으로 읽은 model 정보의 판.
  const userSeq = useRef("");
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const alive = useRef(true);
  useEffect(() => () => {
    alive.current = false;
  }, []);

  const load = useCallback(async (): Promise<void> => {
    const [read, readUser] = await Promise.all([
      source.models(),
      source.userModels(),
    ]);
    if (!alive.current || !read.ok || !readUser.ok) return;
    hidden.current = read.value.hidden;
    userSeq.current = readUser.value.seq;
    setModels(read.value);
    setUser(readUser.value);
  }, [source]);

  const api = useMemo(() => ({
    open() {
      setFirst(null);
      setOpen(true);
      void load();
    },
  }), [load]);

  const change = (
    targets: readonly { provider: string; model_name: string }[],
    hide: boolean,
  ) => {
    queue.current = queue.current.then(async () => {
      const next = setHidden(hidden.current, targets, hide);
      hidden.current = next;
      setModels((now) => now === null ? now : { ...now, hidden: next });
      const written = await source.setHidden(next);
      // 저장하지 못하면 core에 있는 값으로 되돌린다.
      if (!written.ok) await load();
    });
  };

  // 저장이나 지우기가 끝나면 catalog의 user 층도 바뀌므로 둘 다 다시 읽는다. 판이 어긋났으면 읽은 값으로 form을 이어 가게 한다.
  const changeInfo = async (
    provider: string,
    change: (definition: string) => ReturnType<AgentsSource["saveModelInfo"]>,
  ): Promise<ModelInfoOutcome> => {
    const definition = models?.providers.find((item) => item.id === provider)
      ?.definition;
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
      {open
        ? (
          <ManageModelsDialog
            providers={providers}
            onClose={() => setOpen(false)}
            onConnect={() =>
              connect?.open({
                onConnected: (id) => {
                  setFirst(id);
                  void load();
                },
              })}
            onToggleModel={(provider, modelName, hide) =>
              change([{ provider, model_name: modelName }], hide)}
            onToggleProvider={(provider, hide) =>
              change(
                modelsOf(provider).map((model) => ({
                  provider,
                  model_name: model.modelName,
                })),
                hide,
              )}
            onRefresh={async (provider) => {
              const refreshed = await source.refreshModels(provider);
              if (refreshed) await load();
              return refreshed;
            }}
            onSaveInfo={(provider, modelName, info) =>
              changeInfo(provider, (definition) =>
                source.saveModelInfo({
                  provider_definition: definition,
                  model_name: modelName,
                  info,
                }, userSeq.current))}
            onRemoveInfo={(provider, modelName) =>
              changeInfo(provider, (definition) =>
                source.removeModelInfo({
                  provider_definition: definition,
                  model_name: modelName,
                }, userSeq.current))}
          />
        )
        : null}
    </ManageModelsContext.Provider>
  );
}

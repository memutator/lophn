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
import type { ManageProviderView } from "../../../conversation/model-picker/types.ts";
import { manageProviders } from "../../../workspace/agents/model-picker-data.ts";
import type {
  AgentsSource,
  HiddenModel,
  ModelsView,
} from "../../../workspace/agents/source.ts";
import { useConnectProvider } from "./connect-host.tsx";

type ManageSource = Pick<
  AgentsSource,
  "models" | "refreshModels" | "setHidden" | "addModelName"
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
  const [first, setFirst] = useState<string | null>(null);
  const hidden = useRef<readonly HiddenModel[]>([]);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const alive = useRef(true);
  useEffect(() => () => {
    alive.current = false;
  }, []);

  const load = useCallback(async (): Promise<void> => {
    const read = await source.models();
    if (!alive.current || !read.ok) return;
    hidden.current = read.value.hidden;
    setModels(read.value);
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

  const providers: ManageProviderView[] | null = models === null
    ? null
    : manageProviders(models, first);
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
            onAddName={async (provider, modelName) => {
              const added = await source.addModelName(provider, modelName);
              if (added.ok) await load();
              return added.ok;
            }}
          />
        )
        : null}
    </ManageModelsContext.Provider>
  );
}

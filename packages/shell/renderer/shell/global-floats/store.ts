// 전역 float(workspace를 넘는 떠 있는 탭)의 상태와 저장. 접기·펴기·고정·rect·쌓임 규칙은 desk float과 같아야 해서
// floats만 쓰는 빈 desk에 담고 desk-model의 함수를 그대로 쓴다. React를 모른다(`global-floats.tsx`가 읽는다).
import type {
  GlobalFloatRecord,
  GlobalFloatsReadResult,
  GlobalFloatsSaveResult,
} from "../../../ipc/global-floats.ts";
import {
  type Desk,
  emptyDesk,
  type FloatRect,
  type WorkspaceRef,
} from "../desk-model.ts";
import { tabFromStored, tabToStored } from "../layout-source.ts";

/** preload의 `lophnGlobalFloats`. */
export interface GlobalFloatsBridge {
  read(): Promise<GlobalFloatsReadResult>;
  save(input: { floats: GlobalFloatRecord[] }): Promise<GlobalFloatsSaveResult>;
}

export const globalBridge = (): GlobalFloatsBridge | undefined =>
  (globalThis as { lophnGlobalFloats?: GlobalFloatsBridge }).lophnGlobalFloats;

/** 메모리에 두는 가짜 통로. dev mock과 gallery가 쓴다. */
export function fakeGlobalFloatsBridge(
  initial: GlobalFloatRecord[] = [],
): GlobalFloatsBridge {
  let saved = initial;
  return {
    read: () => Promise.resolve({ ok: true, floats: saved }),
    save: ({ floats }) => {
      saved = floats;
      return Promise.resolve({ ok: true });
    },
  };
}

/** 같은 앱·화면은 전역 float 하나다. desk의 tab key 규칙(`[A-Za-z0-9._:-]`)에 맞는다. 다른 kind의 float은 탭 key 그대로다. */
export const globalKey = (app: string, screen: string) =>
  `global:${app}:${screen}`;

export interface GlobalFloatsState {
  /** floats만 쓴다. 아래에서 위 순서다. */
  readonly desk: Desk;
  /** float key → 탭이 나온 workspace. desk에 없는 key는 두지 않는다. */
  readonly workspaces: Readonly<Record<string, WorkspaceRef>>;
  /** 앱 id → 사람이 지은 이름. 저장하지 않고 읽어 온다. */
  readonly names: Readonly<Record<string, string>>;
}

const EMPTY: GlobalFloatsState = {
  desk: emptyDesk("global", "Global"),
  workspaces: {},
  names: {},
};

const HOME: WorkspaceRef = { kind: "home" };

/** 저장한 float을 읽는다. 이 kind를 모르거나 값이 맞지 않는 탭은 그 float만 빠진다. */
function loadedOf(
  records: readonly GlobalFloatRecord[],
): Pick<GlobalFloatsState, "desk" | "workspaces"> {
  const items = records.flatMap((item) => {
    const tab = tabFromStored(item.tab);
    return tab === null ? [] : [{ item, tab }];
  });
  return {
    desk: {
      ...EMPTY.desk,
      floats: items.map(({ item, tab }) => ({
        tab,
        rect: item.rect as FloatRect,
        minimized: item.minimized,
        pinned: item.pinned === true,
      })),
    },
    workspaces: Object.fromEntries(
      items.map(({ item, tab }) => [tab.key, item.workspace as WorkspaceRef]),
    ),
  };
}

export function recordsOf(
  state: Pick<GlobalFloatsState, "desk" | "workspaces">,
): GlobalFloatRecord[] {
  return state.desk.floats.flatMap((item) => {
    const tab = tabToStored(item.tab);
    if (tab === null) return [];
    return [
      {
        workspace: state.workspaces[item.tab.key] ?? HOME,
        tab,
        rect: { ...item.rect },
        minimized: item.minimized,
        ...(item.pinned ? { pinned: true as const } : {}),
      },
    ];
  });
}

/** desk에 없는 key의 workspace를 버린다. */
function prunedWorkspaces(
  desk: Desk,
  workspaces: GlobalFloatsState["workspaces"],
): GlobalFloatsState["workspaces"] {
  const live = new Set(desk.floats.map((item) => item.tab.key));
  return Object.fromEntries(
    Object.entries(workspaces).filter(([key]) => live.has(key)),
  );
}

/** commit이 float을 더할 때 그 float의 workspace를 같이 건넨다. */
export interface Attach {
  readonly key: string;
  readonly workspace: WorkspaceRef;
}

// 잦은 바뀜을 모아 한 번에 쓴다.
const SAVE_DELAY = 200;

export function createGlobalFloatsStore(
  bridge: () => GlobalFloatsBridge | undefined,
) {
  let state = EMPTY;
  // 처음 읽기가 끝나기 전의 바뀜은 읽은 목록 위에 얹는다. 먼저 쓰면 저장된 float을 덮어 잃는다.
  let ready = false;
  const waiting: { change: (desk: Desk) => Desk; attach?: Attach }[] = [];
  let dirty = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<() => void>();

  const set = (next: GlobalFloatsState) => {
    state = next;
    for (const listener of listeners) listener();
  };

  function flush() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (!dirty) return;
    dirty = false;
    void bridge()
      ?.save({ floats: recordsOf(state) })
      .catch(() => {});
  }

  function touched() {
    dirty = true;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(flush, SAVE_DELAY);
  }

  return {
    get: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** desk-model 함수로 floats를 바꾼다. 바뀌었으면 새 desk를 돌려주고 저장을 예약한다. */
    commit(change: (desk: Desk) => Desk, attach?: Attach): Desk {
      if (!ready) {
        waiting.push({ change, ...(attach === undefined ? {} : { attach }) });
        return state.desk;
      }
      const next = change(state.desk);
      if (next !== state.desk) {
        set({
          ...state,
          desk: next,
          workspaces: prunedWorkspaces(next, {
            ...state.workspaces,
            ...(attach === undefined ? {} : { [attach.key]: attach.workspace }),
          }),
        });
        touched();
      }
      return next;
    },
    setName(app: string, name: string) {
      if (state.names[app] === name) return;
      set({ ...state, names: { ...state.names, [app]: name } });
    },
    /** 파일을 읽는다. 처음에는 기다린 바뀜을 얹고, 다시 읽을 때는 쓸 것이 남았으면 읽은 값을 버린다. */
    async load() {
      const api = bridge();
      const reply = await (api?.read() ?? Promise.resolve(null)).catch(
        () => null,
      );
      const loaded = loadedOf(reply?.ok ? reply.floats : []);
      if (!ready) {
        ready = true;
        let next = loaded;
        for (const { change, attach } of waiting.splice(0)) {
          const desk = change(next.desk);
          next = {
            desk,
            workspaces: prunedWorkspaces(desk, {
              ...next.workspaces,
              ...(attach === undefined
                ? {}
                : { [attach.key]: attach.workspace }),
            }),
          };
        }
        set({ ...state, ...next });
        if (next.desk !== loaded.desk) touched();
        return;
      }
      if (
        dirty ||
        JSON.stringify(recordsOf(loaded)) === JSON.stringify(recordsOf(state))
      ) {
        return;
      }
      set({ ...state, ...loaded });
    },
    flush,
  };
}

export type GlobalFloatsStore = ReturnType<typeof createGlobalFloatsStore>;

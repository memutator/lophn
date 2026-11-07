// 전역 float(workspace를 넘는 앱 panel 화면)의 상태와 저장. 접기·펴기·고정·rect·쌓임 규칙은 desk float과 같아야 해서
// floats만 쓰는 빈 desk에 담고 desk-model의 함수를 그대로 쓴다. React를 모른다(`global-floats.tsx`가 읽는다).
import type {
  GlobalFloatRecord,
  GlobalFloatsReadResult,
  GlobalFloatsSaveResult,
} from "../../../ipc/global-floats.ts";
import { type Desk, emptyDesk, type FloatRect } from "../desk-model.ts";

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

/** 같은 앱·화면은 전역 float 하나다. desk의 tab key 규칙(`[A-Za-z0-9._:-]`)에 맞는다. */
export const globalKey = (app: string, screen: string) =>
  `global:${app}:${screen}`;

export interface GlobalFloatsState {
  /** floats만 쓴다. 아래에서 위 순서다. */
  readonly desk: Desk;
  /** 앱 id → 사람이 지은 이름. 저장하지 않고 읽어 온다. */
  readonly names: Readonly<Record<string, string>>;
}

const EMPTY: GlobalFloatsState = {
  desk: emptyDesk("global", "Global"),
  names: {},
};

function deskOf(records: readonly GlobalFloatRecord[]): Desk {
  return {
    ...EMPTY.desk,
    floats: records.map((item) => ({
      tab: {
        key: globalKey(item.app, item.screen),
        kind: "app_panel",
        title: "",
        app: item.app,
        screen: item.screen,
      },
      rect: item.rect as FloatRect,
      minimized: item.minimized,
      pinned: item.pinned === true,
    })),
  };
}

export function recordsOf(desk: Desk): GlobalFloatRecord[] {
  return desk.floats.flatMap((item) =>
    item.tab.app === undefined || item.tab.screen === undefined
      ? []
      : [
          {
            app: item.tab.app,
            screen: item.tab.screen,
            rect: { ...item.rect },
            minimized: item.minimized,
            ...(item.pinned ? { pinned: true as const } : {}),
          },
        ],
  );
}

// 잦은 바뀜을 모아 한 번에 쓴다.
const SAVE_DELAY = 200;

export function createGlobalFloatsStore(
  bridge: () => GlobalFloatsBridge | undefined,
) {
  let state = EMPTY;
  // 처음 읽기가 끝나기 전의 바뀜은 읽은 목록 위에 얹는다. 먼저 쓰면 저장된 float을 덮어 잃는다.
  let ready = false;
  const waiting: ((desk: Desk) => Desk)[] = [];
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
      ?.save({ floats: recordsOf(state.desk) })
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
    commit(change: (desk: Desk) => Desk): Desk {
      if (!ready) {
        waiting.push(change);
        return state.desk;
      }
      const next = change(state.desk);
      if (next !== state.desk) {
        set({ ...state, desk: next });
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
      const loaded = deskOf(reply?.ok ? reply.floats : []);
      if (!ready) {
        ready = true;
        const next = waiting
          .splice(0)
          .reduce((desk, change) => change(desk), loaded);
        set({ ...state, desk: next });
        if (next !== loaded) touched();
        return;
      }
      if (
        dirty ||
        JSON.stringify(recordsOf(loaded)) ===
          JSON.stringify(recordsOf(state.desk))
      ) {
        return;
      }
      set({ ...state, desk: loaded });
    },
    flush,
  };
}

export type GlobalFloatsStore = ReturnType<typeof createGlobalFloatsStore>;

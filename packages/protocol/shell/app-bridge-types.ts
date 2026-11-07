// 앱 view preload bridge(`lophnApp`)의 모양. apps SDK가 import하는 portable entry라 Zod·platform runtime을 싣지 않는다.
import type { Result } from "../../base/result.ts";

export const EXTERNAL_URL_MAX_CHARS = 8192;

export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };

export type TabHeadItem = { id: string; label: string; disabled?: boolean };

/**
 * 앱 화면이 자기 탭의 머리 줄(← →, 경로, ⋯ 메뉴가 있는 줄)에 올리는 것. 글과 id만 싣고 그리는 것은 lophn이다.
 * 누르면 `onTabHead`가 id를 받는다.
 */
export type TabHead = {
  /** 앱 이름 뒤에 붙는 경로. */
  crumbs?: string[];
  /** 경로 뒤 상태 글. */
  status?: string;
  /** 경로 뒤 탭. */
  tabs?: { items: TabHeadItem[]; selected: string | null };
  /** ⋯ 앞 단추. */
  actions?: (TabHeadItem & { primary?: boolean; busy?: boolean })[];
  /** ⋯ 메뉴의 맨 위 묶음. */
  menu?: TabHeadItem[];
  /** 주면 ← →가 앱 안의 뒤로·앞으로가 된다. 없으면 lophn 이동 기록이다. */
  nav?: { canBack: boolean; canForward: boolean };
};

/** `shown`은 lophn이 지금 머리 줄을 그리는지다. false면 앱이 그 조작을 스스로 그린다. */
export type TabHeadEvent =
  | { type: "shown"; shown: boolean }
  | { type: "tab" | "action" | "menu"; id: string }
  | { type: "back" | "forward" };

/**
 * 앱 화면이 자기 앱 workspace의 agent session과 ACP로 이야기하는 길. session이 이 앱 workspace의 것이 아니면 모두
 * `forbidden`이다. `send`는 ACP 입력 `send`·`stop`·`answer`·`rename`만 받고 나머지(승인 `decide` 등)는 `forbidden`이다. 값은 protocol/acp의 `AcpState`·`AcpUpdate`·`AcpInput`이다. 이 entry가 그 type을 import하면 shell main의
 * tsconfig.json(noUncheckedIndexedAccess)이 `base/mod.ts`까지 읽어 깨지므로 type 인자로 두고, 쓰는 쪽(SDK)이 채운다.
 */
export type LophnAppAgent<
  State = unknown,
  Update = unknown,
  Input = unknown,
> = {
  /** 이 앱 workspace에 그 agent의 새 session을 연다. `title`을 주면 sidebar에 보일 session 제목이 된다. */
  open(input: {
    agent: string;
    title?: string;
  }): Promise<Result<{ session: string }>>;
  snapshot(session: string): Promise<Result<State>>;
  /** 이 화면이 열었거나 snapshot·send로 확인한 session의 갱신만 온다. 놓치면 snapshot을 다시 읽는다. */
  onUpdate(listener: (session: string, update: Update) => void): () => void;
  send(input: Input): Promise<Result<void>>;
};

/** 화면이 열린 workspace. project의 folders는 등록한 폴더 path 목록이고, Home과 앱 workspace는 비어 있다. */
export type AppPlaceWorkspace = {
  kind: "project" | "home" | "app";
  id: string;
  folders: string[];
};

/**
 * 화면이 열릴 때 정해진 자리와 인자와 workspace. 읽기만 하고 화면이 열려 있는 동안 바뀌지 않는다.
 * lophn이 준 값이 틀리면 place는 null이고 params는 `{}`, workspace는 null이다.
 */
export type AppPlace = {
  place: "tab" | "panel" | "card" | "sidebar" | "tray" | null;
  params: { [key: string]: Json };
  workspace: AppPlaceWorkspace | null;
};

export type LophnApp = {
  place: AppPlace;
  callOperation(operation: string, input: Json): Promise<unknown>;
  openExternal(url: string): Promise<void>;
  agent: LophnAppAgent;
  /** 이 화면 탭의 머리 줄을 바꾼다. null이면 내린다. */
  setTabHead(head: TabHead | null): void;
  /** 머리 줄의 event를 받는다. 받기 시작하면 지금 `shown`을 바로 한 번 준다. */
  onTabHead(listener: (event: TabHeadEvent) => void): () => void;
  /**
   * true인 동안 사람이 이 화면이 있는 workspace를 떠나도 lophn이 page를 숨겨 살려 둔다(다시 load하지 않는다).
   * `key`마다 켜고 끄며(없으면 하나의 기본 key) 켠 key가 하나라도 있으면 살려 둔다. 앱 코드와 SDK가 서로의 신호를
   * 끄지 않게 하려는 것이다. page가 새로 load되면 모두 꺼지므로 다시 보내야 한다.
   */
  setKeepAlive(active: boolean, key?: string): void;
};

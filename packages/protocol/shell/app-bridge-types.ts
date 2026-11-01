// 앱 view preload bridge(`lophnApp`)의 모양. apps SDK가 import하는 portable entry라 Zod·platform runtime을 싣지 않는다.

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

export type LophnApp = {
  callOperation(operation: string, input: Json): Promise<unknown>;
  openExternal(url: string): Promise<void>;
  /** 이 화면 탭의 머리 줄을 바꾼다. null이면 내린다. */
  setTabHead(head: TabHead | null): void;
  /** 머리 줄의 event를 받는다. 받기 시작하면 지금 `shown`을 바로 한 번 준다. */
  onTabHead(listener: (event: TabHeadEvent) => void): () => void;
};

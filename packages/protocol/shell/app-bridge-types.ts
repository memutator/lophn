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

/** 단추 `icon`으로 쓸 수 있는 이름. lophn이 자기 icon으로 그린다. 모르는 이름은 무시하고 글 단추로 그린다. */
export const TAB_HEAD_ICONS = [
  "refresh",
  "add",
  "open",
  "edit",
  "delete",
  "copy",
  "run",
  "stop",
  "download",
] as const;
export type TabHeadIcon = (typeof TAB_HEAD_ICONS)[number];

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
  /** ⋯ 앞 단추. tray popup은 이것만 icon 단추로 그린다(`icon`이 없으면 작은 글 단추). */
  actions?: (TabHeadItem & {
    primary?: boolean;
    busy?: boolean;
    icon?: TabHeadIcon;
  })[];
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
 * 앱 화면이 agent session과 ACP로 이야기하는 길. 붙을 수 있는 session은 이 앱이 보는 session(이 앱 workspace에서 call로 닿을 수 있는
 * workspace의 lophn·harness session, 터미널 탭 `term:`은 아님)이고 아니면 모두 `forbidden`이다. `send`는 ACP 입력 `send`·`stop`·`answer`·`rename`만 받고 나머지(승인 `decide` 등)는 `forbidden`이다. 값은 protocol/acp의 `AcpState`·`AcpUpdate`·`AcpInput`이다. 이 entry가 그 type을 import하면 shell main의
 * tsconfig.json(noUncheckedIndexedAccess)이 `base/mod.ts`까지 읽어 깨지므로 type 인자로 두고, 쓰는 쪽(SDK)이 채운다.
 */
export type LophnAppAgent<
  State = unknown,
  Update = unknown,
  Input = unknown,
> = {
  /**
   * 그 agent의 새 session을 연다(기본은 이 앱 workspace). 그 session은 이 앱이 열었다는 표시가 붙고(앱은 그 session만 `sessions.end`로 끝낸다,
   * turn 끝 알림이 가지 않는다), `title`을 주면 sidebar에 보일 session 제목이 된다.
   */
  open(input: {
    agent: string;
    title?: string;
    /** 빼면 이 앱 workspace. 주면 이 앱이 call로 닿을 수 있는 workspace(call 정책)이고 아니면 `forbidden`이다. */
    workspace?: { kind: "project" | "app"; id: string };
  }): Promise<Result<{ session: string }>>;
  snapshot(session: string): Promise<Result<State>>;
  /** 이 화면이 열었거나 snapshot·send로 읽은 session의 갱신만 온다. 놓치면 snapshot을 다시 읽는다. */
  onUpdate(listener: (session: string, update: Update) => void): () => void;
  send(input: Input): Promise<Result<void>>;
};

/**
 * 앱 화면이 읽는 lophn project. 앱은 project를 따로 만들지 않고 자기 data를 project에 붙인다. 다른 기계로 따라가야 할
 * data는 `identity`로, 없으면 `id`로 key한다.
 * 폴더 path는 싣지 않는다: 지금 열린 project의 폴더만 `place.workspace.folders`로 준다.
 */
export type AppProject = {
  /** 이 기계에서만 뜻이 있는 id(`prj_`). */
  id: string;
  /**
   * 어느 기계에서도 같은 project를 가리키는 id(`pri_`). git project가 아직 다른 기계와 나눌 준비가 안 됐으면(id file이
   * 없거나 폴더를 아직 읽지 않았으면) null이다.
   */
  identity: string | null;
  /**
   * 이 project가 전에 가졌던 `identity`(오래된 것이 앞, 지금 `identity`는 들지 않는다). 사람이 project를 다른 기계의
   * project와 잇거나 나누면 `identity`가 바뀐다. 앱은 여기 있는 id로 붙은 줄을 `identity`로 옮긴다.
   */
  formerIdentities: string[];
  /** agent 주소(`workspace: {project: name}`)에 쓰는 slug. */
  name: string;
  title: string;
  purpose: string;
  status: "active" | "archived";
};

/** lophn project 읽기. 보관한 project도 싣는다(`status`). */
export type LophnAppProjects = {
  list(): Promise<Result<{ projects: AppProject[] }>>;
};

/**
 * 앱 화면이 읽는 사람의 컴퓨터(폰 제외). `id`는 `connectCommands`의 `on`에 그대로 쓰고 `status`의 이름은 `MachineOption`과 같다.
 * `current`는 이 화면의 backend가 도는 컴퓨터다.
 */
export type AppMachine = {
  id: string;
  name: string;
  status: "online" | "offline" | "connecting" | "update";
  current: boolean;
  /** 그 컴퓨터가 "늘 켜 둠"으로 표시됐나. 그 컴퓨터의 기록이 아직 없으면 null. */
  always_on: boolean | null;
};

export type LophnAppMachines = {
  list(): Promise<Result<{ machines: AppMachine[] }>>;
};

/**
 * 앱 event를 받는다. `source`는 event를 낸 앱의 slug이거나 core가 내는 event의 `lophn`이다. 이 화면의 release가 선언에서
 * 구독(`subscriptions`)한 (source, event)만 온다(선언하지 않으면 listener를 달아도 아무것도 오지 않는다). 화면이 떠 있는
 * 동안만 받고, 놓친 event는 다시 오지 않으므로 처음 값은 발행 앱의 read command로 읽는다. 돌려주는 함수로 listener를 푼다.
 */
export type LophnAppEvents = {
  subscribe(
    source: string,
    event: string,
    listener: (payload: unknown) => void,
  ): () => void;
};

/**
 * lophn의 agent session 목록·상태·멈추기(session lifecycle). 이 앱이 보는 session은 이 앱 workspace에 사는 agent가 call로 닿을 수 있는
 * workspace의 것뿐이다(private workspace는 안 보이고 같은 workspace는 늘 보인다). 안 보이는 session은 없는 session과 같다(`not_found`).
 * 값의 모양은 protocol/lophn-agent/session-lifecycle의 `SessionInfo`다. 이 entry가 그 type을 import하면 shell main의 tsconfig가 깨지므로
 * type 인자로 두고 쓰는 쪽(SDK)이 채운다.
 */
export type LophnAppSessions<Info = unknown, Status = unknown> = {
  list(filter?: {
    workspace?: { kind: "home" } | { kind: "project" | "app"; id: string };
    state?: "running" | "waiting" | "idle" | "unknown";
    harness?: string;
    kind?: "lophn" | "harness" | "terminal";
  }): Promise<Result<{ sessions: Info[] }>>;
  status(session: string): Promise<Result<Status>>;
  /** 도는 turn을 멈추고 그 turn에 딸린 process를 정리한다. 멈춘 것은 사람이 볼 수 있게 기록된다. 터미널 session은 그 CLI의 끊기 key를 보낸다. */
  stop(session: string): Promise<Result<{ stopped: boolean }>>;
  /** 이 앱이 연 session을 끝낸다(archive와 같은 영향). 남이 연 session은 `forbidden`이다. */
  end(session: string): Promise<Result<{ ended: boolean }>>;
};

/**
 * 앱이 agent에게 보내는 call(A2A). 보낼 수 있는 곳은 이 앱 workspace에서 call로 닿을 수 있는 workspace의 agent와 session이다(call 정책).
 * 값의 모양은 protocol/lophn-agent/app-calls의 입력·`AppCallRow`다(type 인자로 두고 SDK가 채운다). 끝남은 `lophn`의 `call.settled`
 * event로 받는다(`events.subscribe("lophn", "call.settled", ...)`, 선언의 `subscriptions`가 필요하다).
 */
export type LophnAppCalls<Input = unknown, Sent = unknown, Row = unknown> = {
  /** 사람이 이 화면에서 보낸 call이라 받는 turn은 attended다. */
  send(input: Input): Promise<Result<Sent>>;
  /** 이 앱이 보낸 call 하나(result call의 답 글 포함). */
  read(call: string): Promise<Result<{ call: Row }>>;
  cancel(
    call: string,
    reason?: string,
  ): Promise<Result<{ call: string; state: string }>>;
  /** 보이는 session이 받은 call들(새것부터, 최대 50). */
  list(session: string): Promise<Result<{ calls: Row[] }>>;
};

/** 이 앱 workspace에서 부를 수 있는 agent들의 명함(protocol의 `AgentCard`가 값의 모양이다). */
export type LophnAppAgents<Card = unknown> = {
  list(): Promise<Result<{ agents: Card[] }>>;
};

/**
 * 화면이 열린 workspace. project의 folders는 등록한 폴더 path 목록이고, Home과 앱 workspace는 비어 있다.
 * project만 `identity`·`formerIdentities`(`AppProject`의 같은 칸)를 싣는다.
 */
export type AppPlaceWorkspace =
  | {
      kind: "project";
      id: string;
      identity: string | null;
      formerIdentities: string[];
      folders: string[];
    }
  | { kind: "home" | "app"; id: string; folders: string[] };

/**
 * 화면이 열릴 때 정해진 자리와 인자와 workspace. 읽기만 하고 화면이 열려 있는 동안 바뀌지 않는다.
 * lophn이 준 값이 틀리면 place는 null이고 params는 `{}`, workspace는 null이다.
 */
export type AppPlace = {
  place: "tab" | "panel" | "card" | "sidebar" | "tray" | "phone" | null;
  params: { [key: string]: Json };
  workspace: AppPlaceWorkspace | null;
};

/**
 * 앱이 선언한 key(`keys`)의 handler를 건다. name은 선언의 key `id`다. `when`이 없거나 참을 돌려줄 때만 handler가
 * 돈다. 맞은 key는 page가 삼키고, `when`이 거짓이면 shell의 key로 넘어간다. 돌려주는 함수로 handler를 푼다.
 */
export type LophnAppCommands = {
  register(name: string, handler: () => void, when?: () => boolean): () => void;
};

export type LophnApp = {
  place: AppPlace;
  callOperation(operation: string, input: Json): Promise<unknown>;
  openExternal(url: string): Promise<void>;
  agent: LophnAppAgent;
  calls: LophnAppCalls;
  agents: LophnAppAgents;
  projects: LophnAppProjects;
  machines: LophnAppMachines;
  events: LophnAppEvents;
  sessions: LophnAppSessions;
  commands: LophnAppCommands;
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

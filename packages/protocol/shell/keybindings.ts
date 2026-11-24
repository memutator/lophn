// 작업대 단축키 표 하나. key 판정과 바인딩이 모두 여기 있고, 받는 곳(main·renderer)도 이 표에 적는다.
// main(shortcuts.ts)은 `main`이 적힌 binding만, renderer(commands/keybinding-service.ts)는 표 전체를 받는다.
// main이 맞춘 binding은 id 글자(`tab.close`, `desk.nth:3`, `app.panel:<app>:<surface>`) 그대로 renderer로
// 가서 parseBindingId로 command와 arg가 된다. 표의 command 이름이 renderer command registry의 id다.
// `app.panel:*`은 표에 줄이 없고 사람이 단 키(overrides)에서만 생긴다(resolveBindings가 표 뒤에 붙인다).
// extension(`ext.<id>.<name>`)·앱(`app.<id>.<name>`)의 command id는 지금 표에 없어도 사람이 단 키를 버리지
// 않는다(parseKeyOverrides). 지금 등록되지 않은 id도 그대로 저장하고, 그 command를 부를 수 없으면 키만 지나간다.
// 이 파일은 shell의 main·preload·renderer와 core(설정 `shell.keybindings`의 검사)가 함께 부르므로 import가 없다.
//
// chord는 "Ctrl+Shift+KeyT"처럼 modifier(Ctrl·Cmd·Alt·Shift)와 KeyboardEvent.code 하나다.
// 두 타를 공백으로 이어 연속 key가 된다(`"Ctrl+KeyX Ctrl+KeyE"`, `"Escape Escape"`). 최대 두 타다.
// 한글 입력기처럼 key가 글자가 아니어도 되도록 code로 판정하고, 글자 키는 배열이 달라도
// 같은 글자가 닿도록 key도 함께 본다. modifier는 정확히 같아야 맞는다(Ctrl+Alt+1은 Alt+1이 아니다).
//
// context는 요소의 `data-key-context` 속성이다. renderer는 keydown에서 target에서 위로 올라가며 만난
// 이름으로 안쪽부터의 stack을 만든다(commands/keybinding-service.ts). 터미널처럼 Ctrl+글자 하나를 자기가
// 가져야 하는 context는 service에 `defineContext`로 owns 규칙을 알린다(shellOwns가 그 규칙이다).

export type Command =
  | "tab.next"
  | "tab.prev"
  | "tab.nth"
  | "tab.close"
  | "tab.reopen"
  | "tab.move-left"
  | "tab.move-right"
  | "tab.rename"
  | "tab.close-others"
  | "tab.close-right"
  | "tab.close-saved"
  | "tab.close-all"
  | "tab.keep-open"
  | "tab.copy-path"
  | "tab.copy-relative-path"
  | "tab.reveal"
  | "pane.split"
  | "pane.split-down"
  | "pane.focus"
  | "pane.focus-left"
  | "pane.focus-right"
  | "pane.focus-up"
  | "pane.focus-down"
  | "pane.swap-left"
  | "pane.swap-right"
  | "pane.swap-up"
  | "pane.swap-down"
  | "pane.stack-next"
  | "pane.stack-prev"
  | "pane.unstack"
  | "pane.remove"
  | "pane.unsplit"
  | "pane.close-others"
  | "pane.close-group"
  | "desk.new"
  | "desk.next"
  | "desk.prev"
  | "desk.nth"
  | "desk.rename"
  | "desk.close"
  | "tab.float"
  | "tab.detach"
  | "float.dock"
  | "float.minimize"
  | "new.terminal"
  | "new.browser"
  | "new.agent"
  | "new.document"
  | "search.open"
  | "files.quick-open"
  | "sidebar.toggle"
  | "explorer.focus"
  | "terminal.focus"
  | "sidebar.toggle-right"
  | "nav.back"
  | "nav.forward"
  | "settings.open"
  | "palette.open"
  | "home.open"
  | "inbox.open"
  | "jobs.open"
  | "terminal.copy"
  | "terminal.paste"
  | "browser.bookmark"
  | "agent.send"
  | "agent.newline"
  | "agent.interrupt"
  | "agent.model-picker"
  | "agent.find"
  | "agent.jump-previous"
  | "agent.jump-next"
  | "agent.scroll-page-up"
  | "agent.scroll-page-down"
  | "agent.scroll-top"
  | "agent.scroll-bottom"
  | "agent.cycle-mode"
  | "agent.send-now"
  | "agent.queue"
  | "agent.rewind"
  | "agent.history-previous"
  | "agent.history-next"
  | "agent.history-search"
  | "agent.background"
  | "agent.toggle-details"
  | "agent.clear-input"
  | "agents.save"
  | "agents.back"
  | "agents.forward"
  | "app.panel";

/** 표의 command id. 내장은 Command, extension·앱은 `ext.<id>.<name>`·`app.<id>.<name>`, project command는 `project-command.<id>.<action>`이다. */
export type BindingCommand =
  | Command
  | `ext.${string}`
  | `app.${string}`
  | `project-command.${string}`;

/** Settings가 묶는 단위. 표의 줄마다 하나다. */
export type KeySection =
  | "tab"
  | "pane"
  | "desk"
  | "float"
  | "open"
  | "view"
  | "agent"
  | "terminal"
  | "browser"
  | "app"
  | "contributed";

export type KeyPlatform = "mac" | "other";

export interface Binding {
  readonly command: BindingCommand;
  readonly section: KeySection;
  /**
   * tab.nth는 1~9와 0(마지막 탭), pane.focus는 고른 group의 leaf 번호(1부터), desk.nth는 1~9,
   * app.panel은 `<app>:<surface>`.
   */
  readonly arg?: number | string;
  /** 이 binding이 듣는 key context 이름. 없으면 context 밖(어디서나)에서 듣는다. */
  readonly context?: string;
  /** Linux·Windows의 chord. */
  readonly other: readonly string[];
  /** macOS의 chord. */
  readonly mac: readonly string[];
  /**
   * main이 먼저 받는 platform. 두 이유다. (1) 앱 view·browser 탭 page에 focus가 있으면 키가
   * page로 가서 renderer의 keydown이 못 받는다. main의 before-input-event가 삼키고 renderer로
   * 보낸다(탭 이동·닫기·다시 열기는 Chrome처럼 page가 받지 않는다). (2) macOS는 menu key
   * equivalent(Cmd+W Close Window)가 page keydown보다 앞서서 renderer에서 preventDefault로는
   * 못 막는다. shell renderer 자신의 키는 Linux·Windows에서 renderer가 받는다(main/desktop/wiring).
   */
  readonly main?: readonly KeyPlatform[];
}

const BOTH: readonly KeyPlatform[] = ["mac", "other"];
const CYCLE = ["Ctrl+Tab", "Ctrl+PageDown"];
const CYCLE_BACK = ["Ctrl+Shift+Tab", "Ctrl+PageUp"];

// 키가 없는 줄은 사람이 Settings에서 단다.
const NONE = { other: [], mac: [] } as const;

const DIRECTIONS = [
  ["left", "ArrowLeft"],
  ["right", "ArrowRight"],
  ["up", "ArrowUp"],
  ["down", "ArrowDown"],
] as const;

// group은 tab 2~4개다. 숫자는 고른 group의 leaf 순서(왼쪽·위에서부터)다.
const PANES = [1, 2, 3, 4];
// Alt+숫자는 macOS에서 Option 글자 입력이라 mac은 Ctrl+숫자다. 0은 마지막 탭.
const TAB_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0];
const DESK_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

// 표의 순서가 받는 순서다. 같은 키를 둘이 가지면 앞이 받는다(기본 표는 context마다 겹침이 없다).
export const KEYBINDINGS: readonly Binding[] = [
  { command: "tab.next", section: "tab", other: CYCLE, mac: CYCLE, main: BOTH },
  {
    command: "tab.prev",
    section: "tab",
    other: CYCLE_BACK,
    mac: CYCLE_BACK,
    main: BOTH,
  },
  ...TAB_NUMBERS.map(
    (arg): Binding => ({
      command: "tab.nth",
      section: "tab",
      arg,
      other: [`Alt+Digit${arg}`],
      mac: [`Ctrl+Digit${arg}`],
    }),
  ),
  {
    command: "tab.close",
    section: "tab",
    other: ["Ctrl+KeyW", "Ctrl+F4"],
    mac: ["Cmd+KeyW"],
    main: BOTH,
  },
  {
    command: "tab.reopen",
    section: "tab",
    other: ["Ctrl+Shift+KeyT"],
    mac: ["Cmd+Shift+KeyT"],
    main: BOTH,
  },
  {
    command: "tab.move-left",
    section: "tab",
    other: ["Ctrl+Shift+PageUp"],
    mac: ["Ctrl+Shift+PageUp"],
    main: BOTH,
  },
  {
    command: "tab.move-right",
    section: "tab",
    other: ["Ctrl+Shift+PageDown"],
    mac: ["Ctrl+Shift+PageDown"],
    main: BOTH,
  },
  { command: "tab.rename", section: "tab", ...NONE },
  { command: "tab.close-others", section: "tab", ...NONE },
  { command: "tab.close-right", section: "tab", ...NONE },
  { command: "tab.close-saved", section: "tab", ...NONE },
  { command: "tab.close-all", section: "tab", ...NONE },
  { command: "tab.keep-open", section: "tab", ...NONE },
  {
    command: "tab.copy-path",
    section: "tab",
    other: ["Alt+Shift+KeyC"],
    mac: ["Cmd+Alt+KeyC"],
  },
  {
    command: "tab.copy-relative-path",
    section: "tab",
    other: ["Ctrl+Alt+Shift+KeyC"],
    mac: ["Cmd+Alt+Shift+KeyC"],
  },
  { command: "tab.reveal", section: "tab", ...NONE },

  {
    command: "pane.split",
    section: "pane",
    other: ["Ctrl+Backslash"],
    mac: ["Cmd+Backslash"],
  },
  {
    command: "pane.split-down",
    section: "pane",
    other: ["Ctrl+Shift+Backslash"],
    mac: ["Cmd+Shift+Backslash"],
  },
  ...PANES.map(
    (arg): Binding => ({
      command: "pane.focus",
      section: "pane",
      arg,
      other: [`Ctrl+Digit${arg}`],
      mac: [`Cmd+Digit${arg}`],
    }),
  ),
  // 고른 group 안에서 방향으로 옮긴다. 편집기·터미널 안에서도 받는다(Ctrl+Alt+화살표는 shell의 Ctrl+글자가 아니다).
  ...DIRECTIONS.map(
    ([direction, key]): Binding => ({
      command: `pane.focus-${direction}`,
      section: "pane",
      other: [`Ctrl+Alt+${key}`],
      mac: [`Cmd+Alt+${key}`],
    }),
  ),
  ...DIRECTIONS.map(
    ([direction, key]): Binding => ({
      command: `pane.swap-${direction}`,
      section: "pane",
      other: [`Ctrl+Alt+Shift+${key}`],
      mac: [`Cmd+Alt+Shift+${key}`],
    }),
  ),
  {
    command: "pane.stack-next",
    section: "pane",
    other: ["Alt+PageDown"],
    mac: ["Alt+PageDown"],
  },
  {
    command: "pane.stack-prev",
    section: "pane",
    other: ["Alt+PageUp"],
    mac: ["Alt+PageUp"],
  },
  { command: "pane.unstack", section: "pane", ...NONE },
  { command: "pane.remove", section: "pane", ...NONE },
  { command: "pane.unsplit", section: "pane", ...NONE },
  { command: "pane.close-others", section: "pane", ...NONE },
  { command: "pane.close-group", section: "pane", ...NONE },

  {
    command: "desk.new",
    section: "desk",
    other: ["Ctrl+Shift+KeyN"],
    mac: ["Cmd+Shift+KeyN"],
  },
  {
    command: "desk.next",
    section: "desk",
    other: ["Ctrl+Alt+PageDown"],
    mac: ["Cmd+Alt+PageDown"],
    main: BOTH,
  },
  {
    command: "desk.prev",
    section: "desk",
    other: ["Ctrl+Alt+PageUp"],
    mac: ["Cmd+Alt+PageUp"],
    main: BOTH,
  },
  ...DESK_NUMBERS.map(
    (arg): Binding => ({
      command: "desk.nth",
      section: "desk",
      arg,
      other: [`Ctrl+Shift+Digit${arg}`],
      mac: [`Ctrl+Shift+Digit${arg}`],
      main: BOTH,
    }),
  ),
  { command: "desk.rename", section: "desk", ...NONE },
  { command: "desk.close", section: "desk", ...NONE },

  { command: "tab.float", section: "float", ...NONE },
  { command: "tab.detach", section: "float", ...NONE },
  { command: "float.dock", section: "float", ...NONE },
  { command: "float.minimize", section: "float", ...NONE },

  {
    command: "new.terminal",
    section: "open",
    other: ["Ctrl+Shift+Backquote"],
    mac: ["Ctrl+Shift+Backquote"],
  },
  {
    command: "new.browser",
    section: "open",
    other: ["Ctrl+KeyT"],
    mac: ["Cmd+KeyT"],
    main: BOTH,
  },
  {
    command: "new.agent",
    section: "open",
    other: ["Ctrl+KeyN"],
    mac: ["Cmd+KeyN"],
  },
  {
    command: "new.document",
    section: "open",
    other: ["Ctrl+KeyO"],
    mac: ["Cmd+KeyO"],
  },
  {
    command: "search.open",
    section: "open",
    other: ["Ctrl+Shift+KeyF"],
    mac: ["Cmd+Shift+KeyF"],
  },
  {
    command: "files.quick-open",
    section: "open",
    other: ["Ctrl+KeyP"],
    mac: ["Cmd+KeyP"],
  },

  {
    command: "sidebar.toggle",
    section: "view",
    other: ["Ctrl+KeyB"],
    mac: ["Cmd+KeyB"],
  },
  {
    command: "explorer.focus",
    section: "view",
    other: ["Ctrl+Shift+KeyE"],
    mac: ["Cmd+Shift+KeyE"],
  },
  {
    command: "terminal.focus",
    section: "view",
    other: ["Ctrl+Backquote"],
    mac: ["Ctrl+Backquote"],
  },
  {
    command: "sidebar.toggle-right",
    section: "view",
    other: ["Ctrl+Alt+KeyB"],
    mac: ["Cmd+Alt+KeyB"],
  },
  {
    command: "nav.back",
    section: "view",
    other: ["Ctrl+Alt+Minus"],
    mac: ["Ctrl+Minus"],
  },
  {
    command: "nav.forward",
    section: "view",
    other: ["Ctrl+Shift+Minus"],
    mac: ["Ctrl+Shift+Minus"],
  },
  {
    command: "settings.open",
    section: "view",
    other: ["Ctrl+Comma"],
    mac: ["Cmd+Comma"],
  },
  // 팔레트·Home은 main이 먼저 받는 자리(guest, macOS)와 renderer keydown이 같은 표를 쓴다.
  {
    command: "palette.open",
    section: "view",
    other: ["Ctrl+KeyK"],
    mac: ["Cmd+KeyK"],
    main: BOTH,
  },
  {
    command: "home.open",
    section: "view",
    other: ["Ctrl+Shift+KeyL"],
    mac: ["Cmd+Shift+KeyL"],
    main: BOTH,
  },
  { command: "inbox.open", section: "view", ...NONE },
  { command: "jobs.open", section: "view", ...NONE },

  // agent 화면의 공통 command. handler는 agent 화면이 올린다(이 계획의 뒤 task). 기본 키는 여기서 정하고
  // harness마다 다른 키는 harness-gui manifest가 context `agentView:<harness>`로 낸다.
  {
    command: "agent.send",
    section: "agent",
    context: "composer",
    other: ["Enter"],
    mac: ["Enter"],
  },
  {
    command: "agent.newline",
    section: "agent",
    context: "composer",
    other: ["Shift+Enter"],
    mac: ["Shift+Enter"],
  },
  {
    command: "agent.interrupt",
    section: "agent",
    context: "agentView",
    other: ["Escape"],
    mac: ["Escape"],
  },
  {
    command: "agent.model-picker",
    section: "agent",
    context: "agentView",
    other: ["Ctrl+Shift+KeyM"],
    mac: ["Cmd+Shift+KeyM"],
  },
  {
    command: "agent.find",
    section: "agent",
    context: "agentView",
    other: ["Ctrl+KeyF"],
    mac: ["Cmd+KeyF"],
  },
  {
    command: "agent.jump-previous",
    section: "agent",
    context: "agentView",
    other: ["Alt+ArrowUp"],
    mac: ["Alt+ArrowUp"],
  },
  {
    command: "agent.jump-next",
    section: "agent",
    context: "agentView",
    other: ["Alt+ArrowDown"],
    mac: ["Alt+ArrowDown"],
  },
  {
    command: "agent.scroll-page-up",
    section: "agent",
    context: "agentView",
    other: ["PageUp"],
    mac: ["PageUp"],
  },
  {
    command: "agent.scroll-page-down",
    section: "agent",
    context: "agentView",
    other: ["PageDown"],
    mac: ["PageDown"],
  },
  {
    command: "agent.scroll-top",
    section: "agent",
    context: "agentView",
    other: ["Ctrl+Home"],
    mac: ["Ctrl+Home"],
  },
  {
    command: "agent.scroll-bottom",
    section: "agent",
    context: "agentView",
    other: ["Ctrl+End"],
    mac: ["Ctrl+End"],
  },
  {
    command: "agent.cycle-mode",
    section: "agent",
    context: "agentView",
    ...NONE,
  },
  {
    command: "agent.send-now",
    section: "agent",
    context: "agentView",
    ...NONE,
  },
  { command: "agent.queue", section: "agent", context: "agentView", ...NONE },
  { command: "agent.rewind", section: "agent", context: "agentView", ...NONE },
  {
    command: "agent.history-previous",
    section: "agent",
    context: "agentView",
    ...NONE,
  },
  {
    command: "agent.history-next",
    section: "agent",
    context: "agentView",
    ...NONE,
  },
  {
    command: "agent.history-search",
    section: "agent",
    context: "agentView",
    ...NONE,
  },
  {
    command: "agent.background",
    section: "agent",
    context: "agentView",
    ...NONE,
  },
  {
    command: "agent.toggle-details",
    section: "agent",
    context: "agentView",
    ...NONE,
  },
  {
    command: "agent.clear-input",
    section: "agent",
    context: "agentView",
    ...NONE,
  },

  // Agents 탭의 agent 설정 저장과 탭 안 이동(목록 ↔ 연 agent). macOS는 Option+방향키가 단어 이동이라 Cmd+[ ]다.
  {
    command: "agents.save",
    section: "view",
    context: "agentsTab",
    other: ["Ctrl+KeyS"],
    mac: ["Cmd+KeyS"],
  },
  {
    command: "agents.back",
    section: "view",
    context: "agentsTab",
    other: ["Alt+ArrowLeft"],
    mac: ["Cmd+BracketLeft"],
  },
  {
    command: "agents.forward",
    section: "view",
    context: "agentsTab",
    other: ["Alt+ArrowRight"],
    mac: ["Cmd+BracketRight"],
  },

  // 터미널의 복사·붙여 넣기. macOS는 Cmd+C/V를 창 menu가 하므로 다른 OS만 기본 키가 있다.
  {
    command: "terminal.copy",
    section: "terminal",
    context: "terminal",
    other: ["Ctrl+Shift+KeyC"],
    mac: [],
  },
  {
    command: "terminal.paste",
    section: "terminal",
    context: "terminal",
    other: ["Ctrl+Shift+KeyV"],
    mac: [],
  },

  // browser page의 bookmark. page에 focus가 있으면 main이, 머리에 있으면 renderer가 이 줄을 본다.
  {
    command: "browser.bookmark",
    section: "browser",
    context: "browser",
    other: ["Ctrl+KeyD"],
    mac: ["Cmd+KeyD"],
    main: BOTH,
  },
];

/** harness GUI 채팅 화면(`agentView:<harness>`)의 기본 단축키. 창 초기화 때 `commands.bind`로 묶고 Ctrl+글자 머리를 context가 가진다. */
export const HARNESS_KEYBINDINGS: readonly {
  readonly command: Command;
  readonly context: string;
  readonly other: readonly string[];
  readonly mac: readonly string[];
}[] = [
  // claude
  {
    command: "agent.cycle-mode",
    context: "agentView:claude",
    other: ["Shift+Tab"],
    mac: ["Shift+Tab"],
  },
  {
    command: "agent.send-now",
    context: "agentView:claude",
    other: ["Ctrl+Enter"],
    mac: ["Ctrl+Enter"],
  },
  {
    command: "agent.queue",
    context: "agentView:claude",
    other: ["Ctrl+KeyX Enter"],
    mac: ["Ctrl+KeyX Enter"],
  },
  {
    command: "agent.rewind",
    context: "agentView:claude",
    other: ["Escape Escape"],
    mac: ["Escape Escape"],
  },
  {
    command: "agent.history-previous",
    context: "agentView:claude",
    other: ["ArrowUp"],
    mac: ["ArrowUp"],
  },
  {
    command: "agent.history-next",
    context: "agentView:claude",
    other: ["ArrowDown"],
    mac: ["ArrowDown"],
  },
  {
    command: "agent.history-search",
    context: "agentView:claude",
    other: ["Ctrl+KeyR"],
    mac: ["Ctrl+KeyR"],
  },
  {
    command: "agent.background",
    context: "agentView:claude",
    other: ["Ctrl+KeyB"],
    mac: ["Ctrl+KeyB"],
  },
  {
    command: "agent.toggle-details",
    context: "agentView:claude",
    other: ["Ctrl+KeyO"],
    mac: ["Ctrl+KeyO"],
  },
  {
    command: "agent.interrupt",
    context: "agentView:claude",
    other: ["Ctrl+KeyC"],
    mac: ["Ctrl+KeyC"],
  },
  {
    command: "agent.clear-input",
    context: "agentView:claude",
    other: ["Ctrl+KeyC"],
    mac: ["Ctrl+KeyC"],
  },
  {
    command: "agent.newline",
    context: "agentView:claude",
    other: ["Ctrl+KeyJ"],
    mac: ["Ctrl+KeyJ"],
  },
  // codex
  {
    command: "agent.cycle-mode",
    context: "agentView:codex",
    other: ["Shift+Tab"],
    mac: ["Shift+Tab"],
  },
  {
    command: "agent.queue",
    context: "agentView:codex",
    other: ["Tab"],
    mac: ["Tab"],
  },
  {
    command: "agent.rewind",
    context: "agentView:codex",
    other: ["Escape Escape"],
    mac: ["Escape Escape"],
  },
  {
    command: "agent.history-previous",
    context: "agentView:codex",
    other: ["ArrowUp"],
    mac: ["ArrowUp"],
  },
  {
    command: "agent.history-next",
    context: "agentView:codex",
    other: ["ArrowDown"],
    mac: ["ArrowDown"],
  },
  {
    command: "agent.history-search",
    context: "agentView:codex",
    other: ["Ctrl+KeyR"],
    mac: ["Ctrl+KeyR"],
  },
  {
    command: "agent.toggle-details",
    context: "agentView:codex",
    other: ["Ctrl+KeyT"],
    mac: ["Ctrl+KeyT"],
  },
  {
    command: "agent.interrupt",
    context: "agentView:codex",
    other: ["Ctrl+KeyC"],
    mac: ["Ctrl+KeyC"],
  },
  {
    command: "agent.clear-input",
    context: "agentView:codex",
    other: ["Ctrl+KeyC"],
    mac: ["Ctrl+KeyC"],
  },
  {
    command: "agent.newline",
    context: "agentView:codex",
    other: ["Ctrl+KeyJ"],
    mac: ["Ctrl+KeyJ"],
  },
  // opencode
  {
    command: "agent.cycle-mode",
    context: "agentView:opencode",
    other: ["Shift+Tab"],
    mac: ["Shift+Tab"],
  },
  {
    command: "agent.queue",
    context: "agentView:opencode",
    other: ["Ctrl+KeyX Enter"],
    mac: ["Ctrl+KeyX Enter"],
  },
  {
    command: "agent.rewind",
    context: "agentView:opencode",
    other: ["Ctrl+KeyX KeyU"],
    mac: ["Ctrl+KeyX KeyU"],
  },
  {
    command: "agent.background",
    context: "agentView:opencode",
    other: ["Ctrl+KeyB"],
    mac: ["Ctrl+KeyB"],
  },
  {
    command: "agent.history-previous",
    context: "agentView:opencode",
    other: ["ArrowUp"],
    mac: ["ArrowUp"],
  },
  {
    command: "agent.history-next",
    context: "agentView:opencode",
    other: ["ArrowDown"],
    mac: ["ArrowDown"],
  },
  {
    command: "agent.interrupt",
    context: "agentView:opencode",
    other: ["Ctrl+KeyC"],
    mac: ["Ctrl+KeyC"],
  },
  {
    command: "agent.clear-input",
    context: "agentView:opencode",
    other: ["Ctrl+KeyC"],
    mac: ["Ctrl+KeyC"],
  },
  {
    command: "agent.newline",
    context: "agentView:opencode",
    other: ["Ctrl+KeyJ"],
    mac: ["Ctrl+KeyJ"],
  },
  // omp
  {
    command: "agent.cycle-mode",
    context: "agentView:omp",
    other: ["Shift+Tab"],
    mac: ["Shift+Tab"],
  },
  {
    command: "agent.queue",
    context: "agentView:omp",
    other: ["Ctrl+KeyQ"],
    mac: ["Ctrl+KeyQ"],
  },
  {
    command: "agent.rewind",
    context: "agentView:omp",
    other: ["Escape Escape"],
    mac: ["Escape Escape"],
  },
  {
    command: "agent.history-search",
    context: "agentView:omp",
    other: ["Ctrl+KeyR"],
    mac: ["Ctrl+KeyR"],
  },
  {
    command: "agent.toggle-details",
    context: "agentView:omp",
    other: ["Ctrl+KeyO"],
    mac: ["Ctrl+KeyO"],
  },
  {
    command: "agent.interrupt",
    context: "agentView:omp",
    other: ["Ctrl+KeyC"],
    mac: ["Ctrl+KeyC"],
  },
  {
    command: "agent.clear-input",
    context: "agentView:omp",
    other: ["Ctrl+KeyC"],
    mac: ["Ctrl+KeyC"],
  },
  {
    command: "agent.newline",
    context: "agentView:omp",
    other: ["Ctrl+KeyJ"],
    mac: ["Ctrl+KeyJ"],
  },
  // antigravity
  {
    command: "agent.cycle-mode",
    context: "agentView:antigravity",
    other: ["Shift+Tab"],
    mac: ["Shift+Tab"],
  },
  {
    command: "agent.history-previous",
    context: "agentView:antigravity",
    other: ["ArrowUp"],
    mac: ["ArrowUp"],
  },
  {
    command: "agent.history-next",
    context: "agentView:antigravity",
    other: ["ArrowDown"],
    mac: ["ArrowDown"],
  },
  {
    command: "agent.toggle-details",
    context: "agentView:antigravity",
    other: ["Ctrl+KeyO"],
    mac: ["Ctrl+KeyO"],
  },
  {
    command: "agent.interrupt",
    context: "agentView:antigravity",
    other: ["Ctrl+KeyC"],
    mac: ["Ctrl+KeyC"],
  },
  {
    command: "agent.clear-input",
    context: "agentView:antigravity",
    other: ["Ctrl+KeyC"],
    mac: ["Ctrl+KeyC"],
  },
  {
    command: "agent.newline",
    context: "agentView:antigravity",
    other: ["Ctrl+KeyJ"],
    mac: ["Ctrl+KeyJ"],
  },
];

/** 한 번 누름. modifier(Ctrl·Cmd·Alt·Shift)와 KeyboardEvent.code 하나다. */
export interface Stroke {
  readonly text: string;
  readonly code: string;
  /** 글자 키는 배열이 달라도 닿도록 key도 본다. */
  readonly letter: string | null;
  readonly ctrl: boolean;
  readonly meta: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
}

/** 조합 하나. 한 타 또는 공백으로 이은 두 타다(`"Ctrl+KeyX Ctrl+KeyE"`). */
export interface Chord {
  readonly text: string;
  readonly strokes: readonly Stroke[];
}

export function parseStroke(text: string): Stroke {
  const parts = text.split("+");
  const code = parts.at(-1)!;
  const mods = parts.slice(0, -1);
  return {
    text,
    code,
    letter: /^Key[A-Z]$/.test(code) ? code.slice(3).toLowerCase() : null,
    ctrl: mods.includes("Ctrl"),
    meta: mods.includes("Cmd"),
    alt: mods.includes("Alt"),
    shift: mods.includes("Shift"),
  };
}

export function parseChord(text: string): Chord {
  return { text, strokes: text.split(" ").map(parseStroke) };
}

interface Compiled {
  readonly binding: Binding;
  readonly mac: readonly Chord[];
  readonly other: readonly Chord[];
}

/** 사람이 바꾼 키. binding id(`tab.close`, `tab.nth:1`, `ext.<id>.<name>`, `app.panel:<app>:<surface>`) → 이 기기 platform의 chord. */
export type KeyOverrides = Readonly<Record<string, readonly string[]>>;

export function bindingId(binding: Binding): string {
  return binding.arg === undefined
    ? binding.command
    : `${binding.command}:${binding.arg}`;
}

/** 앱 panel 화면을 여는 binding의 command. 표에 줄이 없고 사람이 단 키에서만 생긴다. */
export const APP_PANEL = "app.panel";

// app·surface는 `:`와 공백이 없는 글자다. 길이는 앱 id(30자)와 tab의 surface(80자)를 덮고 overrides key 상한(160)에 든다.
const APP_PANEL_ID = /^app\.panel:([^:\s]{1,64}):([^:\s]{1,80})$/;
// extension·앱·project command가 내는 동적 command id. `ext.<extension id>.<name>`, `app.<app id>.<name>`,
// `project-command.<id>.<run|stop|restart>`이다. 가운데 id에는 `.`이 없다. overrides key 상한(160) 안이다.
const PROJECT_COMMAND_ID =
  /^project-command\.[a-z0-9][a-z0-9_-]{0,63}\.(?:run|stop|restart)$/;
const DYNAMIC_ID =
  /^(?:(?:ext|app)\.[^:\s.]{1,64}\.[^:\s]{1,80}|project-command\.[a-z0-9][a-z0-9_-]{0,63}\.(?:run|stop|restart))$/;

export function appPanelBindingId(app: string, surface: string): string {
  return `${APP_PANEL}:${app}:${surface}`;
}

export function projectCommandBindingId(
  id: string,
  action: "run" | "stop" | "restart",
): `project-command.${string}` {
  return `project-command.${id}.${action}`;
}

export function isProjectCommandKeyId(id: string): boolean {
  return PROJECT_COMMAND_ID.test(id);
}

/** 지금 표에 없는 id 가운데 extension·앱·project command가 내는 모양인가. 사람이 단 키를 "없는 command" 줄로 남길 때 쓴다. */
export function isDynamicBindingId(id: string): boolean {
  return DYNAMIC_ID.test(id);
}

/** 앱이 선언한 key의 command id(`app.<app id>.<name>`). 그 key는 앱 page 안에서 듣는다. */
export function isAppKeyId(id: string): boolean {
  return DYNAMIC_ID.test(id) && id.startsWith("app.");
}

const TABLE_IDS = new Map(
  KEYBINDINGS.map((binding) => [bindingId(binding), binding] as const),
);

/** 표에 있는 id의 binding. 없으면 undefined다. */
export function tableBinding(id: string): Binding | undefined {
  return TABLE_IDS.get(id);
}

/**
 * binding id를 command와 arg로. 표에 있는 id, `app.panel:<app>:<surface>`(arg는 `<app>:<surface>`),
 * extension·앱의 동적 id(command가 id 그대로)만 받는다. 모양만 보고 지금 등록됐는지는 보지 않는다.
 */
export function parseBindingId(
  id: string,
): { command: BindingCommand; arg?: number | string } | null {
  const row = TABLE_IDS.get(id);
  if (row !== undefined) {
    return {
      command: row.command,
      ...(row.arg === undefined ? {} : { arg: row.arg }),
    };
  }
  const match = APP_PANEL_ID.exec(id);
  if (match !== null)
    return { command: APP_PANEL, arg: `${match[1]}:${match[2]}` };
  return DYNAMIC_ID.test(id) ? { command: id as BindingCommand } : null;
}

const NAMED_KEYS =
  "Backquote|Backslash|BracketLeft|BracketRight|Comma|Period|Slash|Semicolon|Quote|Minus|Equal|" +
  "ArrowUp|ArrowDown|ArrowLeft|ArrowRight|PageUp|PageDown|Home|End|Tab|Enter|Space|Escape|" +
  "Backspace|Delete|Insert";
const STROKE_TEXT = `(?:(?:Ctrl|Cmd|Alt|Shift)\\+)*(?:Key[A-Z]|Digit[0-9]|F[1-9]|F1[0-2]|${NAMED_KEYS})`;
const CHORD_TEXT = new RegExp(`^${STROKE_TEXT}(?: ${STROKE_TEXT})?$`);
const MAX_CHORDS = 4;

/** chord 글자로 읽을 수 있는가(`Ctrl+Shift+KeyT`, `Ctrl+KeyX Ctrl+KeyE`). */
export function isChordText(value: unknown): value is string {
  return typeof value === "string" && CHORD_TEXT.test(value);
}

/** 받은 값에서 표에 있는 id(와 `app.panel:*`, 동적 id)와 읽을 수 있는 chord만 남긴다. 저장 파일이나 IPC 값이 틀려도 키가 죽지 않게. */
export function parseKeyOverrides(value: unknown): KeyOverrides {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const out: Record<string, readonly string[]> = {};
  for (const [id, chords] of Object.entries(value)) {
    if (parseBindingId(id) === null || !Array.isArray(chords)) continue;
    const valid = chords.filter(isChordText);
    if (valid.length === chords.length && valid.length <= MAX_CHORDS) {
      out[id] = valid;
    }
  }
  return out;
}

/**
 * 표에 사람이 바꾼 키를 덮은 바인딩. 덮는 것은 이 기기 platform의 chord뿐이다. 사람이 단 `app.panel:*`
 * 키는 표 뒤에 붙는다(main이 먼저 받고, 다른 platform의 chord는 비었다). 동적 id(`ext.*`·`app.*`)는
 * 지금 표에 없으므로 여기 붙이지 않는다. 그 command를 아는 쪽(renderer의 기여 binding)이 자기 기본 key에 덮는다.
 */
export function resolveBindings(
  platform: KeyPlatform,
  overrides: KeyOverrides,
): readonly Binding[] {
  const apps = Object.entries(overrides).flatMap(([id, chords]): Binding[] => {
    const parsed = parseBindingId(id);
    if (parsed?.command !== APP_PANEL) return [];
    return [
      {
        command: APP_PANEL,
        section: "app",
        arg: parsed.arg,
        other: platform === "other" ? chords : [],
        mac: platform === "mac" ? chords : [],
        main: BOTH,
      },
    ];
  });
  return [
    ...KEYBINDINGS.map((binding) => {
      const chords = overrides[bindingId(binding)];
      return chords === undefined
        ? binding
        : { ...binding, [platform]: chords };
    }),
    ...apps,
  ];
}

export interface CompiledBindings {
  readonly list: readonly Compiled[];
}

export function compileBindings(
  bindings: readonly Binding[],
): CompiledBindings {
  return {
    list: bindings.map((binding) => ({
      binding,
      mac: binding.mac.map(parseChord),
      other: binding.other.map(parseChord),
    })),
  };
}

const COMPILED = compileBindings(KEYBINDINGS);

/** DOM KeyboardEvent와 Electron Input에서 같은 모양으로 옮긴 키 입력. */
export interface KeyInput {
  readonly key: string;
  readonly code?: string;
  readonly ctrl: boolean;
  readonly meta: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
}

export interface KeyHit {
  /** binding id. main이 renderer로 보내는 글자다. */
  readonly id: string;
  readonly command: BindingCommand;
  readonly arg?: number | string;
}

/** 한 타가 키 입력과 맞는가. modifier는 정확히 같아야 하고, 글자 키는 code가 달라도 key로 맞는다. */
export function strokeMatches(stroke: Stroke, input: KeyInput): boolean {
  if (
    stroke.ctrl !== input.ctrl ||
    stroke.meta !== input.meta ||
    stroke.alt !== input.alt ||
    stroke.shift !== input.shift
  )
    return false;
  if (input.code === stroke.code) return true;
  return stroke.letter !== null && input.key.toLowerCase() === stroke.letter;
}

/** 홑 타 chord가 키 입력과 맞는가. 두 타 chord는 여기서 맞지 않는다(연속 key는 service가 센다). */
export function chordMatches(chord: Chord, input: KeyInput): boolean {
  return chord.strokes.length === 1 && strokeMatches(chord.strokes[0]!, input);
}

/**
 * Ctrl 하나만 누른 글자 키. Linux·Windows의 터미널은 이 키를 PTY로 보낸다. 터미널 context의
 * `owns` 규칙이고, macOS에서는 Cmd를 쓰므로 해당 없다.
 */
export function shellOwns(chord: Chord, platform: KeyPlatform): boolean {
  const stroke = chord.strokes[0];
  return (
    platform === "other" &&
    chord.strokes.length === 1 &&
    stroke !== undefined &&
    stroke.letter !== null &&
    stroke.ctrl &&
    !stroke.alt &&
    !stroke.shift &&
    !stroke.meta
  );
}

/**
 * 키 입력에 맞는 바인딩. `main`이면 main이 받는 것만 본다. context를 주면 그 context의 binding만,
 * 주지 않으면 context 없는 binding만 본다(context는 renderer의 DOM stack이 정하고 main은 browser page만 안다).
 * 두 타 chord는 main이 세지 않는다(단일 key만).
 */
export function matchKey(
  input: KeyInput,
  platform: KeyPlatform,
  only?: "main",
  compiled: CompiledBindings = COMPILED,
  context?: string,
): KeyHit | null {
  for (const { binding, mac, other } of compiled.list) {
    if (only === "main" && !binding.main?.includes(platform)) continue;
    if (binding.context !== context) continue;
    const chord = (platform === "mac" ? mac : other).find((item) =>
      chordMatches(item, input),
    );
    if (chord === undefined) continue;
    return {
      id: bindingId(binding),
      command: binding.command,
      ...(binding.arg === undefined ? {} : { arg: binding.arg }),
    };
  }
  return null;
}

/**
 * 이 표에 없는데 다른 곳이 먼저 쓰는 키. OS 전역 팔레트(`Ctrl/Cmd+Shift+K`)와 OS·글자 편집 키다.
 * 표 키는 document capture에서 터미널·편집기보다 먼저 받으므로 여기 묶으면 글자 편집이 죽는다.
 * 팔레트·Home·터미널 복사·붙여 넣기는 표의 줄이라 여기 없다.
 */
const RESERVED: Readonly<Record<KeyPlatform, readonly string[]>> = {
  mac: [
    "Cmd+Shift+KeyK",
    "Cmd+KeyA",
    "Cmd+KeyC",
    "Cmd+KeyV",
    "Cmd+KeyX",
    "Cmd+KeyZ",
    "Cmd+Shift+KeyZ",
    "Cmd+KeyQ",
    "Cmd+KeyH",
    "Cmd+KeyM",
    "Cmd+Tab",
    "Cmd+Space",
    "Cmd+Shift+Digit3",
    "Cmd+Shift+Digit4",
    "Cmd+Shift+Digit5",
  ],
  other: [
    "Ctrl+Shift+KeyK",
    "Ctrl+KeyA",
    "Ctrl+KeyC",
    "Ctrl+KeyV",
    "Ctrl+KeyX",
    "Ctrl+KeyZ",
    "Ctrl+KeyY",
    "Ctrl+Shift+KeyZ",
    "Alt+F4",
    "Alt+Tab",
  ],
};

export type ChordCheck =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: "unsupported" | "needs_modifier" | "reserved";
    }
  | { readonly ok: false; readonly reason: "taken"; readonly by: Binding };

/** 두 타가 같은 키 조합인가. 글자의 modifier 순서는 보지 않는다. */
export function sameStroke(a: Stroke, b: Stroke): boolean {
  return (
    a.code === b.code &&
    a.ctrl === b.ctrl &&
    a.meta === b.meta &&
    a.alt === b.alt &&
    a.shift === b.shift
  );
}

/** 두 chord가 같은 키 조합인가(타 수와 타마다). */
export function sameChord(a: Chord, b: Chord): boolean {
  return (
    a.strokes.length === b.strokes.length &&
    a.strokes.every((stroke, at) => sameStroke(stroke, b.strokes[at]!))
  );
}

function sameContext(context: string | undefined, other: string | undefined) {
  return (context ?? "") === (other ?? "");
}

/**
 * 사람이 새로 고른 chord를 받을 수 있는가. own은 이 chord를 받을 binding id들이다(번호 줄은 번호마다 하나).
 * context는 그 줄이 듣는 context이고, 다른 context의 같은 key는 겹침이 아니다. extra는 표 밖의 기여 binding이다.
 * modifier 없는 키는 입력칸의 글자를 삼키고, OS가 먼저 쓰는 키는 거절하며, 같은 context에서 다른 바인딩과
 * 같은 key는 한쪽이 듣지 않는다.
 */
export function checkChord(
  text: string,
  own: readonly string[],
  platform: KeyPlatform,
  overrides: KeyOverrides,
  context?: string,
  extra: readonly Binding[] = [],
): ChordCheck {
  if (!CHORD_TEXT.test(text)) return { ok: false, reason: "unsupported" };
  const chord = parseChord(text);
  for (const stroke of chord.strokes) {
    const fKey = /^F([1-9]|1[0-2])$/.test(stroke.code);
    if (!fKey && !stroke.ctrl && !stroke.meta && !stroke.alt) {
      return { ok: false, reason: "needs_modifier" };
    }
    if (
      RESERVED[platform].some((one) => sameStroke(parseStroke(one), stroke))
    ) {
      return { ok: false, reason: "reserved" };
    }
  }
  const by = [...resolveBindings(platform, overrides), ...extra].find(
    (binding) =>
      !own.includes(bindingId(binding)) &&
      sameContext(binding.context, context) &&
      binding[platform].some((one) => sameChord(parseChord(one), chord)),
  );
  return by === undefined ? { ok: true } : { ok: false, reason: "taken", by };
}

const GLYPHS: Readonly<Record<string, string>> = {
  Backquote: "`",
  Backslash: "\\",
  BracketLeft: "[",
  BracketRight: "]",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Semicolon: ";",
  Quote: "'",
  Minus: "-",
  Equal: "=",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
};

/** modifier만 누른 keydown의 code(`ControlLeft` 등)이거나 key(`Control` 등). chord가 아니다. */
export const MODIFIER_CODES = /^(Control|Meta|Alt|Shift|OS)(Left|Right)?$/;

/**
 * Settings에서 누른 키를 chord 글자로. modifier만 누른 중이면 null이다. 물리 자리(code)로 적어
 * 한글 입력 상태나 배열이 달라도 같은 글자가 된다.
 */
export function chordOfInput(input: KeyInput): string | null {
  const code = input.code ?? "";
  if (code === "" || MODIFIER_CODES.test(code)) return null;
  return [
    ...(input.ctrl ? ["Ctrl"] : []),
    ...(input.meta ? ["Cmd"] : []),
    ...(input.alt ? ["Alt"] : []),
    ...(input.shift ? ["Shift"] : []),
    code,
  ].join("+");
}

function modifierParts(stroke: Stroke, platform: KeyPlatform): string[] {
  if (platform === "mac") {
    return [
      stroke.ctrl ? "⌃" : "",
      stroke.alt ? "⌥" : "",
      stroke.shift ? "⇧" : "",
      stroke.meta ? "⌘" : "",
    ].filter((part) => part !== "");
  }
  return [
    ...(stroke.ctrl ? ["Ctrl"] : []),
    ...(stroke.alt ? ["Alt"] : []),
    ...(stroke.shift ? ["Shift"] : []),
  ];
}

function strokeLabel(stroke: Stroke, platform: KeyPlatform): string {
  const key = GLYPHS[stroke.code] ?? stroke.code.replace(/^(Key|Digit)/, "");
  const mods = modifierParts(stroke, platform);
  return platform === "mac"
    ? `${mods.join("")}${key}`
    : [...mods, key].join("+");
}

/** 사람이 읽는 키 이름. 두 타는 공백으로 잇는다(`Ctrl+X Ctrl+E`, `Esc Esc`). macOS는 ⌃⌥⇧⌘ 기호를 붙여 쓴다. */
export function chordLabel(text: string, platform: KeyPlatform): string {
  return parseChord(text)
    .strokes.map((stroke) => strokeLabel(stroke, platform))
    .join(" ");
}

/** modifier만의 이름(`Ctrl+Shift`, `⌃⇧`). 번호 줄처럼 끝 key가 정해지지 않은 키를 보일 때 쓴다. */
export function modifierLabel(modifier: string, platform: KeyPlatform): string {
  const stroke = parseStroke(`${modifier}+Digit0`);
  const mods = modifierParts(stroke, platform);
  return mods.join(platform === "mac" ? "" : "+");
}

/** command의 첫 chord 이름. 팔레트 행의 hint가 쓴다. */
export function commandLabel(
  command: BindingCommand,
  platform: KeyPlatform,
  arg?: number | string,
  overrides: KeyOverrides = {},
): string | null {
  const found = resolveBindings(platform, overrides).find(
    (binding) => binding.command === command && binding.arg === arg,
  );
  const chord = found?.[platform][0];
  return chord === undefined ? null : chordLabel(chord, platform);
}

/** binding id의 첫 chord 이름. menu 항목 옆의 키 칸이 쓴다. 키가 없거나 모르는 id면 null이다. */
export function bindingLabel(
  id: string,
  platform: KeyPlatform,
  overrides: KeyOverrides,
): string | null {
  const found = resolveBindings(platform, overrides).find(
    (binding) => bindingId(binding) === id,
  );
  const chord = found?.[platform][0];
  return chord === undefined ? null : chordLabel(chord, platform);
}

export interface KeyConflict {
  /** 겹친 chord 글자(처음 만난 것). */
  readonly chord: string;
  /** 그 chord를 가진 binding id들(표 순서). RESERVED만 쓰는 키면 하나다. */
  readonly ids: readonly string[];
  /** 이 chord를 RESERVED도 쓴다. */
  readonly reserved: boolean;
}

/**
 * 한 context에서 같은 chord를 가진 binding 묶음, 그리고 RESERVED와 같은 chord를 가진 binding.
 * context가 다르면 같은 key라도 겹침이 아니다(안쪽 context가 먼저 듣는다). 한 binding 안의 같은 chord 둘은
 * 겹침이 아니다. 두 타의 머리가 홑 binding과 같아도 다른 chord다. 겹치면 표 순서가 앞인 binding이 받는다.
 * 예외로 다른 context인데 한쪽이 가리는 둘도 겹침이다.
 * - main이 먼저 받는 context 없는 줄은 앱 page의 key(`isAppKeyId`)를 가린다. page가 key를 받기 전에 main이 삼킨다.
 * - keymap(harness GUI가 내장 command에 건 key, context `<바깥>:<harness>`)은 그 context와 바깥 context의 같은 key를
 *   가린다. keymap끼리는 겹침으로 보지 않는다(같은 key의 두 command가 조건으로 갈린다: Ctrl+C clear-input·interrupt).
 */
export function findConflicts(
  platform: KeyPlatform,
  overrides: KeyOverrides,
  extra: readonly Binding[] = [],
  keymap: readonly Binding[] = [],
): readonly KeyConflict[] {
  const groups: {
    context: string;
    chord: Chord;
    ids: string[];
    reserved: boolean;
  }[] = [];
  const groupOf = (context: string, chord: Chord) => {
    let group = groups.find(
      (item) => item.context === context && sameChord(item.chord, chord),
    );
    if (group === undefined) {
      group = { context, chord, ids: [], reserved: false };
      groups.push(group);
    }
    return group;
  };
  for (const binding of [...resolveBindings(platform, overrides), ...extra]) {
    const id = bindingId(binding);
    for (const text of binding[platform]) {
      const group = groupOf(binding.context ?? "", parseChord(text));
      if (!group.ids.includes(id)) group.ids.push(id);
    }
  }
  const reserved = RESERVED[platform].map(parseChord);
  for (const group of groups) {
    if (reserved.some((one) => sameChord(one, group.chord)))
      group.reserved = true;
  }
  const found: KeyConflict[] = groups
    .filter((group) => group.ids.length >= (group.reserved ? 1 : 2))
    .map((group) => ({
      chord: group.chord.text,
      ids: group.ids,
      reserved: group.reserved,
    }));
  const all = [...resolveBindings(platform, overrides), ...extra];
  const shadow = (
    by: Binding,
    under: Binding,
    covers: (by: Binding, under: Binding) => boolean,
  ) => {
    const ids = [bindingId(by), bindingId(under)];
    if (ids[0] === ids[1] || !covers(by, under)) return;
    for (const text of by[platform]) {
      const chord = parseChord(text);
      if (!under[platform].some((one) => sameChord(parseChord(one), chord))) {
        continue;
      }
      if (
        !found.some(
          (one) =>
            one.chord === chord.text && ids.every((id) => one.ids.includes(id)),
        )
      ) {
        found.push({ chord: chord.text, ids, reserved: false });
      }
    }
  };
  for (const under of all) {
    if (!isAppKeyId(bindingId(under))) continue;
    for (const by of all) {
      shadow(
        by,
        under,
        (main) =>
          main.context === undefined &&
          (main.main?.includes(platform) ?? false),
      );
    }
  }
  for (const by of keymap) {
    for (const under of all) {
      shadow(by, under, (inner, outer) => {
        const context = inner.context ?? "";
        const base = outer.context ?? "";
        return (
          context === base || (base !== "" && context.startsWith(`${base}:`))
        );
      });
    }
  }
  return found;
}

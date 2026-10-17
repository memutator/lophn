export interface Themed {
  readonly light: string;
  readonly dark: string;
}

export const tokens = {
  color: {
    surface: {
      floor: { light: "#f9f9f7", dark: "#0d0d0d" },
      base: { light: "#ffffff", dark: "#161615" },
      subtle: { light: "#f3f2ef", dark: "#1d1d1b" },
      muted: { light: "#ebeae6", dark: "#252523" },
    },
    border: {
      subtle: { light: "#e8e7e2", dark: "#232321" },
      base: { light: "#e1e0d9", dark: "#2c2c2a" },
      strong: { light: "#c3c2b7", dark: "#44443f" },
    },
    text: {
      primary: { light: "#1a1a18", dark: "#f3f3f0" },
      secondary: { light: "#52514e", dark: "#c3c2b7" },
      muted: { light: "#6b6a65", dark: "#96958d" },
      disabled: { light: "#a3a29c", dark: "#5f5e59" },
    },
    ink: {
      background: { light: "#1a1a18", dark: "#f3f3f0" },
      text: { light: "#ffffff", dark: "#161615" },
      hover: { light: "#32322f", dark: "#d9d8d2" },
    },
    link: { light: "#1f66c1", dark: "#6da7ec" },
    focus: { light: "#2a78d6", dark: "#3987e5" },
    selection: { light: "#e7f0fb", dark: "#16263b" },
  },
  status: {
    good: {
      marker: { light: "#0ca30c", dark: "#0ca30c" },
      text: { light: "#006300", dark: "#0ca30c" },
      icon: "circle-check",
    },
    warning: {
      marker: { light: "#fab219", dark: "#fab219" },
      text: { light: "#8a5a00", dark: "#fab219" },
      icon: "triangle-alert",
    },
    serious: {
      marker: { light: "#ec835a", dark: "#ec835a" },
      text: { light: "#a4461f", dark: "#ec835a" },
      icon: "octagon-alert",
    },
    critical: {
      marker: { light: "#d03b3b", dark: "#d03b3b" },
      text: { light: "#b93232", dark: "#e66767" },
      icon: "circle-x",
    },
    neutral: {
      marker: { light: "#898781", dark: "#898781" },
      text: { light: "#52514e", dark: "#c3c2b7" },
      icon: "circle-dashed",
    },
  },
  chart: {
    series: [
      { light: "#2a78d6", dark: "#3987e5", lightNeedsLabelOrTable: false },
      { light: "#eb6834", dark: "#d95926", lightNeedsLabelOrTable: false },
      { light: "#1baf7a", dark: "#199e70", lightNeedsLabelOrTable: true },
      { light: "#eda100", dark: "#c98500", lightNeedsLabelOrTable: true },
      { light: "#e87ba4", dark: "#d55181", lightNeedsLabelOrTable: true },
      { light: "#008300", dark: "#008300", lightNeedsLabelOrTable: false },
      { light: "#4a3aa7", dark: "#9085e9", lightNeedsLabelOrTable: false },
      { light: "#e34948", dark: "#e66767", lightNeedsLabelOrTable: false },
    ],
    other: { light: "#a3a29c", dark: "#6b6a65" },
    line: "2px",
    gap: "2px",
    ring: "2px",
    bar: { max: "24px", radius: "4px" },
    point: "4px",
    height: "240px",
  },
  diff: {
    addLine: { light: "#e6f4e4", dark: "#15261a" },
    addWord: { light: "#bfe3b9", dark: "#1f4a28" },
    deleteLine: { light: "#fbe9e7", dark: "#2d1817" },
    deleteWord: { light: "#f4c4bf", dark: "#5c2622" },
  },
  font: {
    sans: '"Pretendard Variable", system-ui, sans-serif',
    mono: '"JetBrains Mono", monospace',
    weight: { regular: 400, medium: 500, semibold: 600 },
    numeric: "tabular-nums",
  },
  type: {
    caption: { size: "12px", line: "16px" },
    small: { size: "13px", line: "20px" },
    body: { size: "14px", line: "22px" },
    reading: { size: "16px", line: "28px" },
    titleSmall: { size: "16px", line: "24px" },
    title: { size: "20px", line: "28px" },
    display: { size: "28px", line: "36px" },
    tracking: { normal: "0", title: "-0.01em" },
  },
  space: [
    "0px",
    "2px",
    "4px",
    "6px",
    "8px",
    "12px",
    "16px",
    "20px",
    "24px",
    "32px",
    "40px",
    "48px",
    "64px",
  ],
  radius: { xs: "4px", sm: "6px", md: "8px", lg: "12px", full: "9999px" },
  border: { width: "1px", focus: { width: "2px", offset: "2px" } },
  shadow: {
    popover: {
      light: "0 4px 16px rgba(26,26,24,0.08), 0 0 0 1px rgba(26,26,24,0.06)",
      dark: "0 4px 16px rgba(0,0,0,0.32), 0 0 0 1px #2c2c2a",
    },
    dialog: {
      light: "0 16px 48px rgba(26,26,24,0.16), 0 0 0 1px rgba(26,26,24,0.06)",
      dark: "0 16px 48px rgba(0,0,0,0.48), 0 0 0 1px #2c2c2a",
    },
  },
  motion: {
    duration: { short: "120ms", medium: "180ms", long: "240ms" },
    ease: "cubic-bezier(0.2,0,0,1)",
    fade: "120ms",
    distance: "4px",
    pulse: "1600ms",
  },
  z: {
    base: 0,
    sticky: 10,
    shell: 20,
    sheet: 50,
    backdrop: 200,
    dialog: 210,
    palette: 220,
    popover: 230,
    toast: 300,
    tooltip: 400,
  },
  breakpoint: { sm: 640, md: 1024, lg: 1280 },
  layout: {
    panePadding: { narrow: "16px", wide: "32px" },
    sidebar: { min: "200px", max: "400px", collapsed: "56px" },
    // 공용 layout이 페이지 가로 scroll 없이 읽기와 조작을 주는 가장 좁은 패널·카드 폭.
    container: { panel: "320px", card: "240px" },
  },
  // 컨트롤 sm·md·lg 높이·좌우 여백·아이콘과 라벨 간격.
  control: {
    sm: { height: "28px", padX: "8px", icon: "14px" },
    md: { height: "32px", padX: "12px", icon: "16px" },
    lg: { height: "36px", padX: "14px", icon: "16px" },
    gap: "6px",
  },
  // Lucide 기본 크기 16·20px과 선 1.5, 정한 14px.
  icon: { size: { small: "14px", base: "16px", large: "20px" }, stroke: 1.5 },
  // 라벨 위·도움말 아래 6px.
  field: { gap: "6px" },
  // 일반 탭의 활성 밑줄과 본문 간격.
  tab: { indicator: "2px", contentGap: "24px" },
  // 첫 조회의 loading 표시는 이 시간 뒤에만 보인다.
  loading: { delay: "300ms" },
  // 페이지 틀 폭과 목차 폭. 목차 간격 48px은 space 값을 쓴다.
  page: {
    reading: { narrow: "600px", default: "680px", wide: "800px" },
    toc: "220px",
    dashboard: { max: "1440px", columns: 12 },
    list: "360px",
    form: "640px",
    launcher: "1040px",
    overview: "800px",
  },
  // 문서 편집기·읽기의 인용 막대·체크박스·찾기 줄·형식 문제 여백과 목록·sticky 머리·
  // 링크 고르기 폭. 입력 28px·행 32px·아이콘 14px은 control·menu·icon 값을 쓴다.
  // 문서 옆 notice 높이. 아이콘 14px·아래 여백 12px은 icon·space 값을 쓴다.
  editor: {
    quoteBar: "2px",
    check: "16px",
    find: "36px",
    gutter: "24px",
    problemList: "200px",
    stickyHead: "32px",
    linkPicker: "320px",
    notice: "32px",
  },
  // 표 행 높이. 밀도 선택은 표에서만 둔다.
  table: { row: { compact: "36px", comfortable: "44px" } },
  // 트리 행·깊이당 들임·현재 표시 폭과 들임 상한.
  tree: { row: "28px", indent: "12px", marker: "2px", indentCap: 8 },
  // 수치 타일 한 줄 최대 개수.
  stat: { perRow: 4 },
  // 명령 팔레트 항목 높이와 폭·위 여백.
  palette: { item: "36px", width: "640px", top: "12%" },
  // 떠 있는 표면의 지연·행·폭·시간. dialog 안 여백 24px은 space 값을 쓴다.
  tooltip: { delay: "400ms" },
  menu: { row: "32px" },
  dialog: { width: { default: "480px", wide: "640px" } },
  toast: {
    width: "360px",
    duration: { default: "5000ms", brief: "2000ms" },
  },
  chip: { width: "360px" },
  // 아이콘 단추 모서리의 개수 표시 높이와 글자 크기. type 단계보다 작다.
  badge: { size: "12px", font: "9px" },
  // 탭 줄의 탭 최소·최대 폭.
  tabStrip: { min: "96px", max: "240px" },
  // 창 위쪽 바 높이, 창 조절 단추 폭, 닫기 단추 hover 색.
  window: {
    topBar: "36px",
    control: "46px",
    closeHover: { light: "#c42b1c", dark: "#c42b1c" },
    closeText: { light: "#ffffff", dark: "#ffffff" },
  },
  // 파일 아이콘 색. light는 Catppuccin Latte, dark는 Macchiato다.
  fileIcon: {
    text: { light: "#4c4f69", dark: "#cad3f5" },
    blue: { light: "#1e66f5", dark: "#8aadf4" },
    yellow: { light: "#df8e1d", dark: "#eed49f" },
    green: { light: "#40a02b", dark: "#a6da95" },
    overlay1: { light: "#8c8fa1", dark: "#8087a2" },
    peach: { light: "#fe640b", dark: "#f5a97f" },
    red: { light: "#d20f39", dark: "#ed8796" },
    mauve: { light: "#8839ef", dark: "#c6a0f6" },
    sky: { light: "#04a5e5", dark: "#91d7e3" },
    sapphire: { light: "#209fb5", dark: "#7dc4e4" },
    pink: { light: "#ea76cb", dark: "#f5bde6" },
    teal: { light: "#179299", dark: "#8bd5ca" },
    maroon: { light: "#e64553", dark: "#ee99a0" },
    lavender: { light: "#7287fd", dark: "#b7bdf8" },
    rosewater: { light: "#dc8a78", dark: "#f4dbd6" },
    flamingo: { light: "#dd7878", dark: "#f0c6c6" },
  },
  floating: {
    surface: { light: "#ffffff", dark: "#1d1d1b" },
    hover: { light: "#f3f2ef", dark: "#2a2a28" },
    backdrop: { light: "rgba(13,13,13,0.4)", dark: "rgba(0,0,0,0.6)" },
  },
} as const;

export type Tokens = typeof tokens;
export type Theme = keyof Themed;
export type StatusTone = keyof Tokens["status"];
export type SpaceStep = keyof Tokens["space"];
export type Breakpoint = keyof Tokens["breakpoint"];

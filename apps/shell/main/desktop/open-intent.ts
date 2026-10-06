// 창 열기 intent(shell/desktop#R13, R14). OS가 넘기는 실행 인자와 URL에서 읽는 것은
// `--quit`, `--open-app <app ID>`, `lophn://things-to-confirm/<id>` 셋뿐이다. 모양이 조금이라도
// 다르면 아무 대상도 열지 않고 기본 창 요청으로 읽는다. 앱 코드·경로·token·port는 받을 자리가
// 없다. 모양은 contracts/shell/launch.ts의 `launchIntentSchema`·`thingsToConfirmLinkSchema`다
// (node test가 zod를 풀지 못해 같은 모양을 여기서 정규식으로 본다).

export const OPEN_APP_FLAG = "--open-app";
export const QUIT_FLAG = "--quit";
/** OS에 등록하는 URL scheme. */
export const URL_SCHEME = "lophn";

const ULID = "[0-7][0-9a-hjkmnp-tv-z]{25}";
const APP_ID = new RegExp(`^app_${ULID}$`);
// things-to-confirm의 대상은 approval request와 질문이다.
const CONFIRM_LINK = new RegExp(
  `^lophn://things-to-confirm/((?:apr|qst)_${ULID})$`,
);

export type OpenIntent =
  /** 대상 없는 새 기본 창. */
  | { kind: "window" }
  /** 창 없는 종료 요청(desktop#R21). */
  | { kind: "quit" }
  /** 그 앱의 전용 창. */
  | { kind: "app"; app: string }
  /** things-to-confirm에서 그 요청을 고른 화면. confirmation window는 열지 않는다. */
  | { kind: "things-to-confirm"; request: string };

const WINDOW: OpenIntent = { kind: "window" };

/** `lophn://things-to-confirm/<id>` 하나를 엄격히 읽는다. 아니면 undefined다. */
export function readConfirmLink(url: unknown): string | undefined {
  if (typeof url !== "string") return undefined;
  return CONFIRM_LINK.exec(url)?.[1];
}

function isLink(arg: string): boolean {
  return arg.slice(0, URL_SCHEME.length + 1).toLowerCase() ===
    `${URL_SCHEME}:`;
}

/**
 * 실행 인자(첫 시작의 process.argv, second-instance argv)를 읽는다. Chromium이 덧붙이는
 * switch와 실행 파일 경로는 보지 않는다. `--open-app`은 정확히 한 번, 바로 뒤 값이 앱 ID일
 * 때만, 링크는 정확히 하나일 때만 읽는다. 둘이 같이 오거나 모양이 틀리면 기본 창이다.
 */
export function readOpenIntent(argv: readonly string[]): OpenIntent {
  if (argv.includes(QUIT_FLAG)) return { kind: "quit" };
  const flags = argv.flatMap((arg, index) =>
    arg === OPEN_APP_FLAG || arg.startsWith(`${OPEN_APP_FLAG}=`) ? [index] : []
  );
  const links = argv.filter(isLink);
  if (flags.length + links.length !== 1) return WINDOW;
  if (flags.length === 1) {
    const app = argv[flags[0]! + 1];
    if (argv[flags[0]!] !== OPEN_APP_FLAG || app === undefined) return WINDOW;
    return APP_ID.test(app) ? { kind: "app", app } : WINDOW;
  }
  return openUrlIntent(links[0]!);
}

/** macOS `open-url`과 argv의 링크. 등록한 링크 모양이 아니면 기본 창이다. */
export function openUrlIntent(url: unknown): OpenIntent {
  const request = readConfirmLink(url);
  return request === undefined
    ? WINDOW
    : { kind: "things-to-confirm", request };
}

export interface UrlSchemePort {
  setAsDefaultProtocolClient(scheme: string): boolean;
}

export interface UrlSchemeOptions {
  packaged: boolean;
  headless: boolean;
  port: UrlSchemePort;
  log?: (message: string) => void;
}

/**
 * OS URL scheme 등록. packaged 실행에서만 한다. 개발 실행은 Electron 자체를 handler로 남기게
 * 되고, headless 확인은 사람 장치의 OS 등록을 건드리지 않는다.
 */
export function registerUrlScheme(options: UrlSchemeOptions): boolean {
  if (!options.packaged || options.headless) return false;
  const registered = options.port.setAsDefaultProtocolClient(URL_SCHEME);
  if (!registered) options.log?.("lophn 링크를 OS에 등록하지 못했다");
  return registered;
}

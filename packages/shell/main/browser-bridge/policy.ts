// browser bridge의 권한 경계. 어떤 URL이 browser 탭으로 넘어갈 수 있는지, 어떤 요청 줄을
// 받는지, 사용자의 `BROWSER`를 건드리는지를 인자만 보고 답한다(Electron·socket·전역 상태 없음).
export const BRIDGE_ENV = "LPN_BROWSER_BRIDGE";
export const MAX_REQUEST_BYTES = 8192;
export const MAX_REPLY_BYTES = 1024;
export const SOCKET_TIMEOUT_MS = 3000;
export const MAX_URL_CHARS = 8192;
export const BRIDGE_KEY_PATTERN = /^[0-9a-f]{64}$/;

// shell은 core를 import하지 못해서 packages/core/config/shell-settings.ts의 key를 따로 적었다.
// 거기와 같은 글자여야 한다.
export const LINK_SETTING_KEYS = {
  web_links: "shell.browser.web_links",
  local_links: "shell.browser.local_links",
} as const;

export type LinkWhere = "browser_tab" | "system_browser";
export type LinkPrefs = { web_links: LinkWhere; local_links: LinkWhere };

export const DEFAULT_LINK_PREFS: LinkPrefs = {
  web_links: "browser_tab",
  local_links: "browser_tab",
};

const utf8 = new TextEncoder();

export function parseBridgeRequest(
  line: string,
): { key: string; url: string } | null {
  if (typeof line !== "string") return null;
  if (utf8.encode(line).length > MAX_REQUEST_BYTES) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const { v, key, url } = parsed as Record<string, unknown>;
  if (v !== 1) return null;
  if (typeof key !== "string" || !BRIDGE_KEY_PATTERN.test(key)) return null;
  if (typeof url !== "string" || url === "") return null;
  return { key, url };
}

export function isRelayableUrl(input: string): boolean {
  if (typeof input !== "string" || input.length > MAX_URL_CHARS) return false;
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  return url.username === "" && url.password === "";
}

const LOCAL_HOST_PATTERNS = [
  /^localhost$/,
  /\.localhost$/,
  /\.local$/,
  /^127(\.\d{1,3}){3}$/,
  /^10(\.\d{1,3}){3}$/,
  /^192\.168(\.\d{1,3}){2}$/,
  /^172\.(1[6-9]|2\d|3[01])(\.\d{1,3}){2}$/,
  /^169\.254(\.\d{1,3}){2}$/,
  /^::1$/,
  /^f[cd][0-9a-f]{2}:/,
  /^fe[89ab][0-9a-f]:/,
];

export function isLocalHost(hostname: string): boolean {
  const host = hostname
    .toLowerCase()
    .replace(/\.+$/, "")
    .replace(/^\[(.*)\]$/, "$1");
  return LOCAL_HOST_PATTERNS.some((pattern) => pattern.test(host));
}

export function linkTarget(url: string, prefs: LinkPrefs): LinkWhere | null {
  if (!isRelayableUrl(url)) return null;
  return isLocalHost(new URL(url).hostname)
    ? prefs.local_links
    : prefs.web_links;
}

function isLinkWhere(value: unknown): value is LinkWhere {
  return value === "browser_tab" || value === "system_browser";
}

/** core `settings/list` 답에서 link 설정 둘을 읽는다. 모양이 틀리거나 값이 틀리면 key별로 기본값이다. */
export function linkPrefsOf(listed: unknown): LinkPrefs {
  const entries = (listed as { settings?: unknown } | null)?.settings;
  const prefs = { ...DEFAULT_LINK_PREFS };
  if (!Array.isArray(entries)) return prefs;
  for (const name of ["web_links", "local_links"] as const) {
    const entry = entries.find(
      (e) =>
        typeof e === "object" &&
        e !== null &&
        e.key === LINK_SETTING_KEYS[name],
    );
    if (entry === undefined) continue;
    const value = "chosen" in entry ? entry.chosen : entry.default;
    if (isLinkWhere(value)) prefs[name] = value;
  }
  return prefs;
}

/**
 * 터미널 자식 process에 줄 env. 사용자가 직접 둔 `BROWSER`는 덮지 않고 null이다.
 * `BRIDGE_ENV`가 있으면 그 `BROWSER`는 바깥 lophn이 넣은 shim이라 덮는다.
 */
export function bridgeEnv(
  processEnv: Record<string, string | undefined>,
  issued: { shim: string; socket: string; key: string },
): Record<string, string> | null {
  const userBrowser = processEnv.BROWSER;
  if (
    userBrowser !== undefined &&
    userBrowser !== "" &&
    processEnv[BRIDGE_ENV] === undefined
  )
    return null;
  return {
    BROWSER: issued.shim,
    [BRIDGE_ENV]: JSON.stringify({ socket: issued.socket, key: issued.key }),
  };
}

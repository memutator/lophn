// 터미널에서 Ctrl/Cmd-click한 link를 어디에서 열지. 사람의 설정(`shell.browser.web_links`·`local_links`)이 browser 탭이면 창이 그
// 터미널 옆에 탭을 열고, 아니면 OS browser다. 터미널 안 program이 `$BROWSER`로 연 것은 core의 bridge가 같은 설정으로 정한다.
// shell은 core를 import하지 못해 설정 key를 따로 적었다(`packages/core/config/shell-settings.ts`와 같은 글자여야 한다).
const LINK_SETTING_KEYS = {
  web_links: "shell.browser.web_links",
  local_links: "shell.browser.local_links",
} as const;

export const LINK_SETTING_KEY_LIST: string[] = Object.values(LINK_SETTING_KEYS);

type LinkWhere = "browser_tab" | "system_browser";

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

function isLocalHost(hostname: string): boolean {
  const host = hostname
    .toLowerCase()
    .replace(/\.+$/, "")
    .replace(/^\[(.*)\]$/, "$1");
  return LOCAL_HOST_PATTERNS.some((pattern) => pattern.test(host));
}

/** core `settings/list` 답(`listed`)으로 그 URL을 열 곳을 정한다. 값을 읽지 못하면 browser 탭이다. url은 이미 검사한 http(s) 주소다. */
export function linkWhere(url: string, listed: unknown): LinkWhere {
  const name = isLocalHost(new URL(url).hostname) ? "local_links" : "web_links";
  const entries = (listed as { settings?: unknown } | null)?.settings;
  const entry = Array.isArray(entries)
    ? (
        entries as { key?: unknown; chosen?: unknown; default?: unknown }[]
      ).find(
        (one) =>
          typeof one === "object" &&
          one !== null &&
          one.key === LINK_SETTING_KEYS[name],
      )
    : undefined;
  const value =
    entry === undefined
      ? undefined
      : "chosen" in entry
        ? entry.chosen
        : entry.default;
  return value === "system_browser" ? "system_browser" : "browser_tab";
}

// settings 화면의 순수 규칙. 원시 enum·ID를 화면 말로 바꾸고, 모르는 값을
// 지어내지 않는다. 화면 컴포넌트와 테스트가 같이 쓴다.
import { formatDate, t } from "@lophn/wording";

import type { ApplyAt, AuthWay, ServerAuth, SettingRow } from "./source.ts";

/**
 * 내장 정의가 알려 준 연결 방법만, 정해진 순서(로그인, key)로. 인증 없음은 내장 정의에 없고 직접 만든
 * custom provider의 loopback에만 있어 고르는 방법이 아니다.
 */
export function waysOf(
  ways: readonly AuthWay[],
): Exclude<AuthWay, "none">[] {
  const order: Exclude<AuthWay, "none">[] = ["oauth", "api_key"];
  return order.filter((way) => ways.includes(way));
}

export function wayLabel(way: AuthWay): string {
  switch (way) {
    case "oauth":
      return t("settings.label.way-sign-in");
    case "api_key":
      return t("settings.label.way-api-key");
    case "none":
      return t("settings.label.way-local");
  }
}

const SHORT_TIME: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
};

export function timeText(iso: string): string {
  return formatDate(new Date(iso), "en", SHORT_TIME);
}

/** 설정 효력 시점. */
export function applyText(applyAt: ApplyAt): string {
  switch (applyAt) {
    case "next_run":
      return t("settings.label.apply-next-work");
    case "current_check":
      return t("settings.label.apply-now");
    case "next_call":
      return t("settings.label.apply-next-call");
  }
}

/** 저장 이름(`next_run`)처럼 생긴 값은 첫 글자를 키운 낱말로, 사람이 쓴 글은 그대로 둔다. */
function slugText(value: string): string {
  if (!/^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*$/.test(value)) return value;
  const words = value.replace(/[-_]/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** 설정 값을 사람의 말로. 목록·객체는 개수로만 말한다. */
export function valueText(value: unknown, resolved: boolean): string {
  if (!resolved) return t("settings.label.value-not-set");
  if (typeof value === "boolean") {
    return value ? t("settings.label.value-on") : t("settings.label.value-off");
  }
  if (typeof value === "number") {
    return new Intl.NumberFormat("en").format(value);
  }
  if (typeof value === "string") {
    return value === "" ? t("settings.label.value-not-set") : slugText(value);
  }
  if (Array.isArray(value)) {
    return t("settings.label.value-items", { count: value.length });
  }
  if (value !== null && typeof value === "object") {
    return t("settings.label.value-custom");
  }
  return t("settings.label.value-not-set");
}

/** 확장 설정과 따로 보이는 것은 General에서 뺀다. */
const SHOWN_ELSEWHERE = new Set([
  "lophn-agent.extensions.skill_folders",
  "lophn-agent.extensions.skills_off",
  "lophn-agent.extensions.mcp_servers",
]);

export function generalRows(rows: readonly SettingRow[]): SettingRow[] {
  return rows.filter((row) => !SHOWN_ELSEWHERE.has(row.key));
}

export function serverAuthLabel(auth: ServerAuth): string {
  switch (auth) {
    case "none":
      return t("settings.label.auth-none");
    case "bearer":
      return t("settings.label.auth-bearer");
    case "api_key":
      return t("settings.label.auth-api-key");
    case "oauth2":
      return t("settings.label.auth-sign-in");
  }
}

const SERVER_NAME = /^[A-Za-z0-9_-]{1,32}$/;
const ABSOLUTE = /^(\/|[A-Za-z]:\\).+/;
const HEADER = /^[A-Za-z0-9-]{1,64}$/;
const HTTP_URL =
  /^(https:\/\/\S+|http:\/\/(127\.0\.0\.1|\[::1\])(:\d+)?(\/\S*)?)$/;

export function validServerName(name: string): boolean {
  return SERVER_NAME.test(name);
}

export function validExecutable(path: string): boolean {
  return ABSOLUTE.test(path);
}

export function validServerUrl(url: string): boolean {
  return HTTP_URL.test(url);
}

export function validHeader(name: string): boolean {
  return HEADER.test(name);
}

/** 인수는 한 줄에 하나다. 빈 줄은 버린다(shell 해석 없음). */
export function argsOf(text: string): string[] {
  return text.split("\n").map((line) => line.replace(/\r$/, "")).filter((
    line,
  ) => line !== "");
}

/** 폴더 경로의 마지막 이름. 사람이 고른 폴더를 이름으로 보인다. */
export function folderName(path: string): string {
  const parts = path.split(/[\\/]+/).filter((part) => part !== "");
  return parts[parts.length - 1] ?? path;
}

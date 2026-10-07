// settings 화면의 순수 규칙. 원시 enum·ID를 화면 말로 바꾸고(shell/wording#R4), 모르는 값을
// 지어내지 않는다(shell/wording#R10). 화면 컴포넌트와 테스트가 같이 쓴다.
import type { StatusTone } from "@lophn/design";
import { formatDate, t } from "@lophn/wording";

import type {
  AccountRow,
  ApplyAt,
  AuthWay,
  CostLine,
  ModelDefaults,
  ModelUse,
  ProviderRow,
  ServerAuth,
  SettingRow,
  UsageRow,
} from "./source.ts";

/** 등록한 연결이 먼저, 그 안에서 이름 순서, 같은 이름은 정의 순서를 따라 안정하게 둔다. */
export function sortProviders(
  rows: readonly ProviderRow[],
): ProviderRow[] {
  return [...rows].sort((a, b) =>
    Number(b.registered) - Number(a.registered) ||
    Number(b.enabled) - Number(a.enabled) ||
    a.name.localeCompare(b.name, "en") || a.id.localeCompare(b.id)
  );
}

/** 계정은 사람이 정한 순서다. 같은 연결 안에서 앞 계정이 먼저 쓰인다. */
export function sortAccounts(rows: readonly AccountRow[]): AccountRow[] {
  return [...rows].sort((a, b) => a.order - b.order);
}

/** 연결이 알려 준 방식만, 정해진 순서(로그인, key, 로컬)로. */
export function waysOf(ways: readonly AuthWay[]): AuthWay[] {
  const order: AuthWay[] = ["oauth", "api_key", "none"];
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

/** 과금 방식. API 과금·구독 한도·이 컴퓨터는 서로 다른 말이다. */
export function billingLabel(way: AuthWay): string {
  switch (way) {
    case "api_key":
      return t("settings.label.billing-api");
    case "oauth":
      return t("settings.label.billing-subscription");
    case "none":
      return t("settings.label.billing-local");
  }
}

export type AccountStatus =
  | "ready"
  | "disabled"
  | "sign-in-problem"
  | "signed-out"
  | "plan"
  | "limit"
  | "removed";

/** 상태는 하나의 말이다. 사용량 한도와 인증 문제를 섞지 않는다. */
export function accountStatus(account: AccountRow): AccountStatus {
  if (account.state === "revoked") return "removed";
  if (account.state === "usage_wait") return "limit";
  if (account.state === "rejected") {
    if (account.reason === "plan_access") return "plan";
    if (account.reason === "refresh_revoked") return "signed-out";
    return "sign-in-problem";
  }
  return account.enabled ? "ready" : "disabled";
}

export function statusLabel(status: AccountStatus): string {
  switch (status) {
    case "ready":
      return t("settings.label.state-ready");
    case "disabled":
      return t("settings.label.state-disabled");
    case "sign-in-problem":
      return t("settings.label.state-sign-in-problem");
    case "signed-out":
      return t("settings.label.state-signed-out");
    case "plan":
      return t("settings.label.state-plan");
    case "limit":
      return t("settings.label.state-limit");
    case "removed":
      return t("settings.label.state-removed");
  }
}

export function statusTone(status: AccountStatus): StatusTone {
  switch (status) {
    case "ready":
      return "good";
    case "limit":
    case "plan":
    case "disabled":
      return "warning";
    case "sign-in-problem":
    case "signed-out":
      return "serious";
    case "removed":
      return "neutral";
  }
}

/** 다음 행동 하나. 해결할 것이 없으면 null이다. */
export type NextAction =
  | "replace-key"
  | "sign-in"
  | "wait"
  | "check-plan"
  | "add-account";

export function nextAction(account: AccountRow): NextAction | null {
  switch (accountStatus(account)) {
    case "sign-in-problem":
      return account.way === "oauth" ? "sign-in" : "replace-key";
    case "signed-out":
      return "sign-in";
    case "limit":
      return "wait";
    case "plan":
      return "check-plan";
    case "removed":
      return "add-account";
    default:
      return null;
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

/** 다음 행동 문장. 한도 대기는 시각을 보이되 서버가 확인했다고 말하지 않는다. */
export function nextText(account: AccountRow): string | null {
  switch (nextAction(account)) {
    case "replace-key":
      return t("settings.next.replace-key");
    case "sign-in":
      return t("settings.next.sign-in");
    case "wait":
      return account.until === null
        ? t("settings.next.wait")
        : t("settings.next.wait-until", { time: timeText(account.until) });
    case "check-plan":
      return t("settings.next.check-plan");
    case "add-account":
      return t("settings.next.add-account");
    case null:
      return null;
  }
}

/** 계정·조직·요금제는 확인한 것만 이어 보인다. 모르는 것은 말하지 않는다. */
export function accountFacts(account: AccountRow): string[] {
  return [account.account, account.organization, account.plan].filter((
    value,
  ): value is string => value !== null);
}

/** model 하나를 이 계정에서 쓸 수 없게 막은 것들의 문장. */
export function blockText(
  block: AccountRow["modelBlocks"][number],
): string {
  return block.reason === "account_model_access"
    ? t("settings.state.model-access", { model: block.model })
    : t("settings.state.model-gone", { model: block.model });
}

function moneyText(line: CostLine): string | null {
  if (line.amount === null || line.currency === null) return null;
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency: line.currency,
    maximumFractionDigits: 4,
  }).format(Number(line.amount));
}

/**
 * 실제 청구·추정·구독 포함·무료·모름을 구별한다. 모름은 0이 아니라 모른다고 말한다.
 */
export function costText(line: CostLine): string {
  switch (line.kind) {
    case "reported":
      return t("settings.label.cost-reported", {
        amount: moneyText(line) ?? "",
      });
    case "estimated":
      return t("settings.label.cost-estimated", {
        amount: moneyText(line) ?? "",
      });
    case "subscription":
      return t("settings.label.cost-subscription", { count: line.calls });
    case "free":
      return t("settings.label.cost-free", { count: line.calls });
    case "unknown":
      return t("settings.label.cost-unknown", { count: line.calls });
  }
}

/** 사용이 없으면 비용 줄도 없다. 기록이 빠졌으면 일부라고 말한다. */
export function usageLines(usage: UsageRow): string[] {
  if (usage.calls === 0) return [t("settings.label.usage-none")];
  const lines = usage.costs.map(costText);
  if (!usage.complete) lines.push(t("settings.label.usage-partial"));
  return lines;
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
  "lophn-agent.extensions.mcp_servers",
]);

export function generalRows(rows: readonly SettingRow[]): SettingRow[] {
  return rows.filter((row) => !SHOWN_ELSEWHERE.has(row.key));
}

export function useLabel(use: ModelUse): string {
  return use === "decisions"
    ? t("settings.models.for-decisions")
    : t("settings.models.for-summaries");
}

export function useHelp(use: ModelUse): string {
  return use === "decisions"
    ? t("settings.defaults.decisions-help")
    : t("settings.defaults.summaries-help");
}

export function choiceOf(
  defaults: ModelDefaults,
  use: ModelUse,
): ModelDefaults["decisions"] {
  return use === "decisions" ? defaults.decisions : defaults.summaries;
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

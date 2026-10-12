// coding agent 연결 화면의 순수 계산: 안쪽 값(harness id, discovery, 단계 이름)을 en 문구와 tone으로 바꾼다.
// 안쪽 이름은 화면에 그대로 나가지 않고 wording key가 사람 말로 바꾼다.
import type { StatusTone } from "@lophn/design";
import { t } from "@lophn/wording";

import type {
  ConnectionRow,
  ConnectView,
  HarnessName,
  HarnessView,
} from "./source.ts";

/** 제품 이름은 고정 문구다. */
export function harnessName(id: HarnessName): string {
  switch (id) {
    case "claude":
      return t("settings.label.harness-claude");
    case "codex":
      return t("settings.label.harness-codex");
    case "opencode":
      return t("settings.label.harness-opencode");
    case "gemini":
      return t("settings.label.harness-gemini");
    case "hermes":
      return t("settings.label.harness-hermes");
    case "pi":
      return t("settings.label.harness-pi");
    case "openclaw":
      return t("settings.label.harness-openclaw");
  }
}

export function discoveryText(harness: HarnessView): string {
  switch (harness.discovery) {
    case "detected":
      return t("settings.label.coding-found");
    case "absent":
      return t("settings.label.coding-not-found");
    case "unobserved":
      return t("settings.label.coding-not-checked");
    default:
      return t("settings.label.coding-check-failed");
  }
}

export function discoveryTone(harness: HarnessView): StatusTone {
  switch (harness.discovery) {
    case "detected":
      return "good";
    case "absent":
    case "unobserved":
      return "neutral";
    default:
      return "warning";
  }
}

/** 존재만으로 version·로그인이 확인됐다고 하지 않는다. 확인 못한 것은 확인 못했다고 말한다. */
export function versionText(harness: HarnessView): string {
  return harness.version_result === "verified" && harness.version !== null
    ? t("settings.label.coding-version", { version: harness.version })
    : t("settings.label.coding-version-unknown");
}

export function authText(harness: HarnessView): string {
  switch (harness.auth) {
    case "verified":
      return t("settings.label.coding-signed-in");
    case "not_verified":
      return t("settings.label.coding-sign-in-not-found");
    default:
      return t("settings.label.coding-sign-in-unknown");
  }
}

/** 감지된 harness만 고를 수 있다. */
export function pickable(harness: HarnessView): boolean {
  return harness.discovery === "detected";
}

export function defaultLabel(harness: HarnessName): string {
  return t("settings.label.coding-default-name", {
    name: harnessName(harness),
  });
}

export function scopeText(
  row: Pick<ConnectionRow, "scope">,
  appName: (app: string) => string | null,
): string {
  if (row.scope.kind === "all") return t("settings.label.coding-scope-all");
  const name = appName(row.scope.app);
  return name === null
    ? t("settings.label.coding-scope-one-app-unknown")
    : t("settings.label.coding-scope-one-app", { name });
}

/** 한 줄 이름: 공백만이 아니고 줄바꿈이 없고 80자 안이다. */
export function validLabel(text: string): boolean {
  const label = text.trim();
  return label !== "" && !/[\r\n]/.test(label) && [...label].length <= 80;
}

export function installText(status: ConnectView["install"]["status"]): string {
  switch (status) {
    case "complete":
      return t("settings.label.coding-install-complete");
    case "partial":
      return t("settings.label.coding-install-partial");
    case "failed":
      return t("settings.label.coding-install-failed");
    case "error":
      return t("settings.label.coding-install-error");
  }
}

export function installTone(
  status: ConnectView["install"]["status"],
): StatusTone {
  return status === "complete" ? "good" : "serious";
}

const STAGES = new Set([
  "mcp_initialize",
  "tool_discovery",
  "skill_discovery",
  "app_guide_loading",
]);

/** loading 단계 이름. 모르는 단계는 지어낸 이름 대신 일반 문구다. */
export function stageText(stage: string): string {
  switch (STAGES.has(stage) ? stage : "") {
    case "mcp_initialize":
      return t("settings.label.coding-stage-connect");
    case "tool_discovery":
      return t("settings.label.coding-stage-tools");
    case "skill_discovery":
      return t("settings.label.coding-stage-skills");
    case "app_guide_loading":
      return t("settings.label.coding-stage-guide");
    default:
      return t("settings.label.coding-stage-other");
  }
}

export function checkText(result: "success" | "failure" | "unknown"): string {
  switch (result) {
    case "success":
      return t("settings.label.coding-check-ok");
    case "failure":
      return t("settings.label.coding-check-failed-stage");
    case "unknown":
      return t("settings.label.coding-check-unknown");
  }
}

/** 확인하지 못한 단계를 성공 색으로 칠하지 않는다. */
export function checkTone(
  result: "success" | "failure" | "unknown",
): StatusTone {
  return result === "success"
    ? "good"
    : result === "failure"
    ? "serious"
    : "warning";
}

/** 연결 실패 이유(code)를 사람 문장으로. */
export function connectErrorText(code: string): string {
  switch (code) {
    case "not_detected":
      return t("settings.error.coding-not-detected");
    case "conflict":
      return t("settings.error.coding-conflict");
    case "forbidden":
    case "invalid_input":
      return t("settings.error.coding-refused");
    default:
      return t("settings.error.coding-unavailable");
  }
}

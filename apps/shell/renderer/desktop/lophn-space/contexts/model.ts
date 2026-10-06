// contexts 화면의 순수 규칙. 화면 컴포넌트와 core 통로가 같이 쓴다.
import { t } from "@lophn/wording";

import type {
  FocusExport,
  FocusItem,
  FocusTarget,
  FocusWatch,
  Perspective,
  WatchChange,
} from "./source.ts";

/** 뜻마다 보이는 출현 근거 수의 상한(documents/terms#R1). */
export const EVIDENCE_LIMIT = 5;

export function targetKey(target: FocusTarget): string {
  return target.kind === "document"
    ? `document:${target.document}:${target.section ?? ""}`
    : `app:${target.app}:${target.command}`;
}

/** 관점 이름. 안쪽 이름(기준·참고·watch)은 화면에 내지 않는다(wording#R13). */
export function perspectiveLabel(perspective: Perspective): string {
  switch (perspective) {
    case "basis":
      return t("contexts.view.baseline");
    case "reference":
      return t("contexts.view.reference");
    case "watch":
      return t("contexts.view.follow-changes");
  }
}

export type Gap =
  | "unreadable"
  | "no-version"
  | "section-missing"
  | "section-unverified"
  | "unsupported";

/** 항목에 부족한 자료. 읽을 수 있으면 비었다. 추정하지 않고 받은 상태만 옮긴다. */
export function gapsOf(item: FocusItem): Gap[] {
  if (item.target.kind === "app_command") {
    return item.readable ? [] : ["unreadable"];
  }
  if (item.version === null) return ["no-version"];
  if (item.target.section !== null) {
    if (item.sectionStatus === "missing") return ["section-missing"];
    if (item.sectionStatus === "unverified") return ["section-unverified"];
    if (item.sectionStatus === "unsupported") return ["unsupported"];
  }
  return item.readable ? [] : ["unreadable"];
}

export type WatchState =
  | { readonly kind: "app" }
  | { readonly kind: "unread" }
  | { readonly kind: "quiet" }
  | { readonly kind: "changed"; readonly change: WatchChange }
  | { readonly kind: "missing"; readonly change: WatchChange | null }
  | {
    readonly kind: "unverified";
    readonly reason: UnverifiedReason;
    readonly afterVersion: string | null;
  };

export type UnverifiedReason = "pending" | "format" | "other";

// documents/contexts work.ts의 이유 글. 화면은 원문 대신 이 셋으로만 말한다.
export function unverifiedReasonOf(reason: string): UnverifiedReason {
  if (reason === "extraction pending") return "pending";
  if (reason === "format module changed") return "format";
  return "other";
}

/**
 * Follow changes 항목 하나의 지금 상태. 미확인은 확인된 변화로 말하지 않고, section 소실은
 * 변화 기록이나 최신 판의 소실로 따로 말한다(documents/contexts#R9, R11). watch 결과를 읽지
 * 못했으면 unread다.
 */
export function watchStateOf(
  item: FocusItem,
  watch: FocusWatch | null,
): WatchState {
  if (item.target.kind === "app_command") return { kind: "app" };
  const key = targetKey(item.target);
  if (watch === null) return { kind: "unread" };
  const pending = watch.unverified.find((row) => targetKey(row.target) === key);
  if (pending) {
    return {
      kind: "unverified",
      reason: unverifiedReasonOf(pending.reason),
      afterVersion: pending.afterVersion,
    };
  }
  // 변화는 최근 것부터 온다.
  const latest =
    watch.changes.find((change) => targetKey(change.target) === key) ?? null;
  if (item.target.section !== null && item.sectionStatus === "missing") {
    return { kind: "missing", change: latest };
  }
  if (latest === null) {
    return item.target.section !== null && item.sectionStatus === "unverified"
      ? { kind: "unverified", reason: "pending", afterVersion: null }
      : { kind: "quiet" };
  }
  if (latest.kind === "section_missing") {
    return { kind: "missing", change: latest };
  }
  return { kind: "changed", change: latest };
}

function targetLine(
  target: FocusTarget,
  titles: ReadonlyMap<string, string>,
): string {
  const title = titles.get(targetKey(target)) || t("contexts.label.untitled");
  if (target.kind === "app_command") {
    return t("contexts.label.export-app", { title });
  }
  return target.section === null
    ? title
    : t("contexts.label.export-section", { title, section: target.section });
}

/**
 * export JSON을 사람이 저장할 Markdown으로 그린다(documents Q20). 목적, 관점별 직접 항목과
 * 선택 이유, 읽은 고정 판, 사람이 정한 뜻만 싣는다. 제목은 화면이 이미 읽은 항목 제목이다.
 */
export function exportMarkdown(
  value: FocusExport,
  titles: ReadonlyMap<string, string>,
): string {
  const lines: string[] = [
    `# ${t("contexts.title.focus", { title: value.title })}`,
    "",
    value.purpose,
  ];
  for (const perspective of ["basis", "reference", "watch"] as const) {
    const items = value.items.filter((item) =>
      item.perspective === perspective
    );
    lines.push("", `## ${perspectiveLabel(perspective)}`, "");
    if (items.length === 0) {
      lines.push(t("contexts.empty.perspective"));
      continue;
    }
    for (const item of items) {
      lines.push(`- ${targetLine(item.target, titles)}`);
      lines.push(`  - ${t("contexts.label.reason")}: ${item.reason}`);
      if (item.fixedVersion !== null) {
        lines.push(
          `  - ${t("contexts.label.read-version")}: \`${item.fixedVersion}\``,
        );
      }
    }
  }
  lines.push("", `## ${t("contexts.label.tab-meanings")}`, "");
  if (value.glossary.length === 0) {
    lines.push(t("contexts.empty.definitions"));
  }
  for (const term of value.glossary) {
    lines.push(`- **${term.name}**: ${term.definition}`);
  }
  return `${lines.join("\n")}\n`;
}

/** 저장 파일 이름. 경로 문자를 빼고 Markdown 확장자를 붙인다. */
export function exportFileName(title: string): string {
  const base = title.replace(/[\\/:*?"<>|\n\r\t]+/g, " ").trim();
  return `${base === "" ? "focus" : base}.md`;
}

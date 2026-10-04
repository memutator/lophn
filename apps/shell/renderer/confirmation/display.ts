import { t } from "@lophn/wording";

// confirmation window가 그리는 표시 자료.
// contracts#T13의 owner_decision은 comparison을 자유 json object로 두고,
// 그 안을 채우는 표시 read는 documents#T12·T19의 files.delete다.
// 정해진 키가 없는 자료는 화면이 지어내지 않고 없다고 말한다.

export interface TextLine {
  readonly text: string;
  /** 줄 안의 바뀐 자리. 없으면 줄 전체가 한 조각이다. */
  readonly spans?: readonly { text: string; changed?: boolean }[];
}

export interface TextBlock {
  readonly lines: readonly TextLine[];
  /** 바뀐 문단 앞뒤의 문맥 문단. */
  readonly role: "context" | "changed";
}

/** 문서 전후. 바뀐 문단과 앞뒤 1문단만 기본으로 보인다. */
export interface DocumentChange {
  readonly kind: "document";
  readonly before: readonly TextBlock[];
  readonly after: readonly TextBlock[];
  /** 복원하지 못한 구간. 빈 본문으로 꾸미지 않는다. */
  readonly omitted?: string;
  /** 전체·code diff. 기본에서는 접는다. */
  readonly full?: readonly {
    kind: "same" | "add" | "delete";
    text: string;
  }[];
}

/** 설정 전후. 항목과 값만 보인다. */
export interface SettingChange {
  readonly kind: "setting";
  readonly items: readonly {
    label: string;
    before: string | null;
    after: string | null;
  }[];
}

/** diff로 표현할 수 없는 동작. 현재·바뀐 뒤 설명이다. */
export interface DescriptionChange {
  readonly kind: "description";
  readonly before: string | null;
  readonly after: string | null;
}

export type Change = DocumentChange | SettingChange | DescriptionChange;

export interface DetailFact {
  readonly label: string;
  readonly value: string;
}

/**
 * 기본 배치에 필요한 것만 담는다.
 * path는 정확한 대상이라 고정폭 원문으로 보이고, 그 밖의 식별자·hash는 details다.
 */
export interface Display {
  /** 결정 자체를 말하는 제목 문장. */
  readonly title: string;
  /** 대상·변경. */
  readonly subject: string;
  /** 정확한 경로·대상의 원문. 줄이지 않는다. */
  readonly path?: string;
  /** 영향·위험. */
  readonly effect: string;
  /** revert 가능 여부. */
  readonly reversible: boolean;
  /** 주 결정 버튼의 이름. */
  readonly action: string;
  /** 주체·시각·이유·근거·상세 전후. 기본에서는 접는다. */
  readonly details: readonly DetailFact[];
  readonly change?: Change;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function lines(value: unknown): TextLine[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: TextLine[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.text !== "string") return undefined;
    const spans = item.spans;
    if (spans === undefined) {
      out.push({ text: item.text });
      continue;
    }
    if (!Array.isArray(spans)) return undefined;
    const parts: { text: string; changed?: boolean }[] = [];
    for (const span of spans) {
      if (!isRecord(span) || typeof span.text !== "string") return undefined;
      parts.push(
        span.changed === true
          ? { text: span.text, changed: true }
          : { text: span.text },
      );
    }
    out.push({ text: item.text, spans: parts });
  }
  return out;
}

function blocks(value: unknown): TextBlock[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: TextBlock[] = [];
  for (const item of value) {
    if (!isRecord(item)) return undefined;
    const parsed = lines(item.lines);
    if (parsed === undefined) return undefined;
    const role = item.role === "changed" ? "changed" : "context";
    out.push({ lines: parsed, role });
  }
  return out;
}

function changeOf(value: unknown): Change | undefined {
  if (!isRecord(value) || typeof value.kind !== "string") return undefined;
  if (value.kind === "document") {
    const before = blocks(value.before);
    const after = blocks(value.after);
    if (before === undefined || after === undefined) return undefined;
    const full: { kind: "same" | "add" | "delete"; text: string }[] = [];
    if (Array.isArray(value.full)) {
      for (const row of value.full) {
        if (!isRecord(row) || typeof row.text !== "string") return undefined;
        const kind = row.kind === "add" || row.kind === "delete"
          ? row.kind
          : "same";
        full.push({ kind, text: row.text });
      }
    }
    return {
      kind: "document",
      before,
      after,
      omitted: text(value.omitted),
      full: full.length > 0 ? full : undefined,
    };
  }
  if (value.kind === "setting") {
    if (!Array.isArray(value.items)) return undefined;
    const items: {
      label: string;
      before: string | null;
      after: string | null;
    }[] = [];
    for (const item of value.items) {
      if (!isRecord(item) || typeof item.label !== "string") return undefined;
      items.push({
        label: item.label,
        before: typeof item.before === "string" ? item.before : null,
        after: typeof item.after === "string" ? item.after : null,
      });
    }
    return { kind: "setting", items };
  }
  if (value.kind === "description") {
    return {
      kind: "description",
      before: typeof value.before === "string" ? value.before : null,
      after: typeof value.after === "string" ? value.after : null,
    };
  }
  return undefined;
}

function facts(value: unknown): DetailFact[] {
  if (!Array.isArray(value)) return [];
  const out: DetailFact[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const label = text(item.label);
    const fact = text(item.value);
    if (label !== undefined && fact !== undefined) {
      out.push({ label, value: fact });
    }
  }
  return out;
}

/**
 * comparison에서 화면이 아는 키만 읽는다.
 * 키가 없으면 undefined를 돌려 화면이 자료 없음을 말하게 한다.
 */
export function readDisplay(
  comparison: Record<string, unknown>,
): Display | undefined {
  const title = text(comparison.title);
  const subject = text(comparison.subject);
  const effect = text(comparison.effect);
  const action = text(comparison.action);
  if (
    title === undefined || subject === undefined || effect === undefined ||
    action === undefined || typeof comparison.reversible !== "boolean"
  ) {
    return undefined;
  }
  return {
    title,
    subject,
    path: text(comparison.path),
    effect,
    reversible: comparison.reversible,
    action,
    details: facts(comparison.details),
    change: changeOf(comparison.change),
  };
}

/** files.delete의 첫 표시. 대상 파일의 정확한 경로를 숨기지 않는다. */
export function fileDeleteDisplay(input: {
  path: string;
  document?: string;
  requestedBy?: string;
  requestedAt?: string;
}): Display {
  const details: DetailFact[] = [];
  if (input.document !== undefined) {
    details.push({ label: "Document", value: input.document });
  }
  if (input.requestedBy !== undefined) {
    details.push({ label: "Requested by", value: input.requestedBy });
  }
  if (input.requestedAt !== undefined) {
    details.push({ label: "Requested", value: input.requestedAt });
  }
  return {
    title: t("confirmation-window.file-delete.title"),
    subject: t("confirmation-window.file-delete.subject"),
    path: input.path,
    effect: t("confirmation-window.file-delete.effect"),
    reversible: false,
    action: t("confirmation-window.button.delete-file"),
    details,
  };
}

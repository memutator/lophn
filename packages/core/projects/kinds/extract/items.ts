// kind마다 glob에 맞는 파일을 item으로 읽는다. 값을 칸 type으로 맞추고 문서 하나에서 정해지는 위반(`unreadable`,
// `required`, `type`, `overlap`)을 낸다. item 전체를 봐야 아는 규칙(unique, ref, pattern, enum)은 check/fields.ts다.
import type {
  Kind,
  KindField,
  Violation,
} from "../../../../protocol/projects/mod.ts";
import { type Capturer, compileCapture } from "./capture.ts";
import { type DocumentData, readDocument } from "./document.ts";
import { kindMatcher } from "./glob.ts";

export type DocumentViolation = Extract<Violation, { source: "document" }>;

export type ProjectFiles = {
  paths(): readonly string[];
  // 읽을 수 없으면 null
  read(path: string): string | null;
};

export type Item = {
  kind: string;
  key: string;
  // project 기준 상대 경로
  path: string;
  // 확장자를 뺀 파일 이름
  file: string;
  // 선언한 칸의 값(없으면 null). list 칸은 배열이다.
  fields: Record<string, unknown>;
};

export type FileOutcome = {
  // glob이 둘 이상 kind에 맞아 어느 kind도 아니면 null
  kind: string | null;
  // item으로 올리지 못하면 skipped
  status: "ok" | "skipped";
};

export type Extracted = {
  items: Item[];
  files: Map<string, FileOutcome>;
  violations: DocumentViolation[];
};

export function fileNameOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? name : name.slice(0, dot);
}

// YAML 스칼라를 글로 바꾼다. 스칼라가 아니면 undefined.
function toText(raw: unknown): string | undefined {
  switch (typeof raw) {
    case "string":
      return raw;
    case "number":
    case "boolean":
    case "bigint":
      return String(raw);
    default:
      return raw instanceof Date ? raw.toISOString().slice(0, 10) : undefined;
  }
}

function toDate(raw: unknown): string | undefined {
  const text = toText(raw);
  if (text === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return undefined;
  const [year, month, day] = text.split("-").map(Number);
  const at = new Date(Date.UTC(year!, month! - 1, day!));
  return at.getUTCFullYear() === year && at.getUTCMonth() === month! - 1 &&
      at.getUTCDate() === day
    ? text
    : undefined;
}

// 값 하나를 type에 맞춘다. 맞출 수 없으면 undefined.
function coerce(type: KindField["type"], raw: unknown): unknown {
  switch (type) {
    case "string":
    case "enum":
    case "ref":
      return toText(raw);
    case "number":
      return typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
    case "boolean":
      return typeof raw === "boolean" ? raw : undefined;
    case "date":
      return toDate(raw);
  }
}

function coerceField(field: KindField, raw: unknown): unknown {
  if (!field.list) return coerce(field.type, raw);
  if (!Array.isArray(raw)) return undefined;
  const values = raw.map((element) => coerce(field.type, element));
  return values.includes(undefined) ? undefined : values;
}

function keyOf(kind: Kind, item: Omit<Item, "key">): string {
  const value = kind.key === "path"
    ? item.path
    : kind.key === "file"
    ? item.file
    : item.fields[kind.key];
  const text = typeof value === "string" || typeof value === "number" ||
      typeof value === "boolean"
    ? String(value)
    : "";
  return text === "" ? item.path : text;
}

export function extractItems(
  kinds: readonly Kind[],
  files: ProjectFiles,
): Extracted {
  const kindsOf = kindMatcher(kinds);
  const captures = new Map<string, Capturer>();
  const capturer = (pattern: string) => {
    let capture = captures.get(pattern);
    if (capture === undefined) {
      capture = compileCapture(pattern);
      captures.set(pattern, capture);
    }
    return capture;
  };
  const out: Extracted = { items: [], files: new Map(), violations: [] };

  for (const path of files.paths()) {
    const matched = kindsOf(path);
    if (matched.length === 0) continue;
    const kind = matched[0]!;
    const violate = (
      rule: DocumentViolation["rule"],
      field: string | null,
      message: string,
    ) =>
      out.violations.push({
        source: "document",
        rule,
        kind: kind.name,
        path,
        field,
        message,
      });

    if (matched.length > 1) {
      violate(
        "overlap",
        null,
        `file matches more than one kind: ${
          matched.map((k) => k.name).join(", ")
        }`,
      );
      out.files.set(path, { kind: null, status: "skipped" });
      continue;
    }
    const document: DocumentData | null = readDocument(path, files.read);
    if (document === null) {
      violate("unreadable", null, "file cannot be read as a document");
      out.files.set(path, { kind: kind.name, status: "skipped" });
      continue;
    }

    const fields: Record<string, unknown> = {};
    let wrongType = false;
    for (const [name, field] of Object.entries(kind.fields)) {
      let raw: unknown;
      if (field.from === "path") {
        const text = capturer(field.capture!)(path)?.[name];
        raw = text === undefined
          ? undefined
          : field.type === "number"
          ? Number(text)
          : text;
      } else {
        raw = Object.hasOwn(document, name) ? document[name] : undefined;
      }
      if (raw === undefined || raw === null) {
        fields[name] = null;
        if (field.required) {
          violate("required", name, `field ${name} is required`);
        }
        continue;
      }
      const value = coerceField(field, raw);
      if (value === undefined) {
        wrongType = true;
        fields[name] = null;
        violate(
          "type",
          name,
          `field ${name} must be ${
            field.list ? "a list of " : ""
          }${field.type}`,
        );
        continue;
      }
      fields[name] = value;
    }
    if (wrongType) {
      out.files.set(path, { kind: kind.name, status: "skipped" });
      continue;
    }
    const item = { kind: kind.name, path, file: fileNameOf(path), fields };
    out.items.push({ ...item, key: keyOf(kind, item) });
    out.files.set(path, { kind: kind.name, status: "ok" });
  }
  return out;
}

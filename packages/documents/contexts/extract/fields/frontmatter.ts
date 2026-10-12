import type { FieldCoercer, FieldReader } from "../types.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// 값이 없으면 null(YAML null도 같다).
function orNull(value: unknown): unknown {
  return value === undefined ? null : value;
}

// 개체 문서의 frontmatter 키 하나(최상위 키만).
export const frontmatterField: FieldReader<"frontmatter"> = (from, context) => {
  const frontmatter = context.document?.frontmatter;
  if (frontmatter === undefined) return null;
  return Object.hasOwn(frontmatter, from.key)
    ? orNull(frontmatter[from.key])
    : null;
};

// 개체 문서(file 없음) 또는 개체 폴더 아래 file의 YAML 값을 key_path로 따라간다.
export const yamlField: FieldReader<"yaml"> = (from, context) => {
  let value: unknown;
  if (from.file === undefined) {
    value = context.document?.data;
  } else {
    value = context.readDocument(`${context.anchor.path}/${from.file}`)?.data;
  }
  for (const key of from.key_path) {
    if (!isRecord(value) || !Object.hasOwn(value, key)) return null;
    value = value[key];
  }
  return orNull(value);
};

// YAML 스칼라를 쓰인 글로 바꾼다. 스칼라가 아니면 그대로 둔다.
function toText(raw: unknown): unknown {
  switch (typeof raw) {
    case "number":
    case "boolean":
    case "bigint":
      return String(raw);
    default:
      return raw instanceof Date ? raw.toISOString().slice(0, 10) : raw;
  }
}

// YAML이 읽은 값을 field의 value_type에 맞춘다. 맞출 수 없으면 그대로 둔다.
export const coerceFieldValue: FieldCoercer = (field, raw) => {
  if (raw === null || raw === undefined) return null;
  if (field.value_type === "string") return toText(raw);
  if (
    field.value_type === "list" && field.item_type === "string" &&
    Array.isArray(raw)
  ) {
    return raw.map(toText);
  }
  return raw;
};

import type { Kind } from "../../../../protocol/projects/mod.ts";

export type FieldInfo = { type: string; list: boolean };

// 조건·정렬·집계가 가리킬 수 있는 칸: 선언한 칸과 모든 item에 늘 있는 path, file.
export function fieldInfos(kind: Kind): Map<string, FieldInfo> {
  const infos = new Map<string, FieldInfo>([
    ["path", { type: "string", list: false }],
    ["file", { type: "string", list: false }],
  ]);
  for (const [name, field] of Object.entries(kind.fields)) {
    infos.set(name, { type: field.type, list: field.list === true });
  }
  return infos;
}

export type Row = {
  key: string;
  path: string;
  file: string;
  fields: Record<string, unknown>;
};

export function valueAt(row: Row, field: string): unknown {
  if (field === "path") return row.path;
  if (field === "file") return row.file;
  return Object.hasOwn(row.fields, field) ? row.fields[field] : null;
}

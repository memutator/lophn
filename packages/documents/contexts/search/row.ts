// 행에서 path 값을 읽고 개체 ref를 만든다. 다른 검색 모듈이 같이 쓴다.
import type { EntityRef, Row, SearchEntity } from "./types.ts";

export function refOf(entity: SearchEntity): EntityRef {
  return {
    type: entity.type,
    key: entity.key,
    path: entity.path,
    section: entity.section,
  };
}

function fieldOf(entity: SearchEntity, field: string): unknown {
  if (field === "key") return entity.key;
  if (field === "path") return entity.path;
  return entity.fields[field] ?? null;
}

// `field`는 시작 개체, `alias.field`는 별칭 개체의 값이다. 없는 별칭·field는 null이다.
export function valueAt(row: Row, path: string): unknown {
  const dot = path.indexOf(".");
  if (dot < 0) return fieldOf(row.base, path);
  const alias = row.aliases[path.slice(0, dot)];
  return alias === undefined
    ? null
    : fieldOf(alias.entity, path.slice(dot + 1));
}

// path가 가리키는 개체(field가 key일 때만).
export function refAt(row: Row, path: string): EntityRef | null {
  const dot = path.indexOf(".");
  const field = dot < 0 ? path : path.slice(dot + 1);
  if (field !== "key") return null;
  if (dot < 0) return refOf(row.base);
  const alias = row.aliases[path.slice(0, dot)];
  return alias === undefined ? null : refOf(alias.entity);
}

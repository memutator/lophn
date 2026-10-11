import type { FieldCoercer, FieldReader } from "../types.ts";

// 개체 문서의 frontmatter 키 하나(최상위 키만).
export const frontmatterField: FieldReader<"frontmatter"> = (_from, _context) =>
  null;

// 개체 문서(file 없음) 또는 개체 폴더 아래 file의 YAML 값을 key_path로 따라간다.
export const yamlField: FieldReader<"yaml"> = (_from, _context) => null;

export const coerceFieldValue: FieldCoercer = (_field, _raw) => null;

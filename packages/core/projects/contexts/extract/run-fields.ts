// field 하나를 읽어 YAML 값을 value_type에 맞춘다. from의 kind마다 읽는 모듈이 다르다.
import type { ContractField } from "../../../../protocol/projects/mod.ts";
import {
  coerceFieldValue,
  frontmatterField,
  yamlField,
} from "./fields/frontmatter.ts";
import { itemField, linksField, pathField } from "./fields/path-capture.ts";
import {
  outlineField,
  sectionField,
  titleField,
} from "./fields/section-body.ts";
import type { FieldContext } from "./types.ts";

function readRaw(field: ContractField, context: FieldContext): unknown {
  const { from } = field;
  switch (from.kind) {
    case "frontmatter":
      return frontmatterField(from, context);
    case "yaml":
      return yamlField(from, context);
    case "section":
      return sectionField(from, context);
    case "path":
      return pathField(from, context);
    case "title":
      return titleField(from, context);
    case "links":
      return linksField(from, context);
    case "outline":
      return outlineField(from, context);
    case "item":
      return itemField(from, context);
  }
}

// 값이 없으면 null.
export function readField(
  field: ContractField,
  context: FieldContext,
): unknown {
  return coerceFieldValue(field, readRaw(field, context) ?? null);
}

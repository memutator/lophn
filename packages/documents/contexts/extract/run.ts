import type {
  BundleContent,
  ContractType,
} from "../../../protocol/projects/mod.ts";
import { readDocumentFrom } from "./document.ts";
import { appDataKind } from "./app-data.ts";
import { docsKind } from "./docs.ts";
import { folderKind } from "./folder.ts";
import { indexKind } from "./index.ts";
import { outlineKind } from "./outline.ts";
import { readField } from "./run-fields.ts";
import { sectionKind } from "./section.ts";
import { seriesKind } from "./series.ts";
import type {
  AppDataReader,
  DocumentReader,
  EntityAnchor,
  ExtractedEntity,
  ExtractResult,
  ExtractViolation,
  KindContext,
  KindResult,
  ProjectFiles,
  TypeOfKind,
} from "./types.ts";

type Resolved = { anchors: EntityAnchor[]; violations: ExtractViolation[] };

const EMPTY: Resolved = { anchors: [], violations: [] };

function runKind(type: ContractType, context: KindContext): KindResult {
  const source = type.source;
  switch (source.kind) {
    case "folder":
      return folderKind(type as TypeOfKind<"folder">, context);
    case "docs":
      return docsKind(type as TypeOfKind<"docs">, context);
    case "series":
      return seriesKind(type as TypeOfKind<"series">, context);
    case "index":
      return indexKind(type as TypeOfKind<"index">, context);
    case "section":
      return sectionKind(type as TypeOfKind<"section">, context);
    case "outline":
      return outlineKind(type as TypeOfKind<"outline">, context);
    case "app-data":
      return appDataKind(type as TypeOfKind<"app-data">, context);
  }
}

function hasDocument(anchor: EntityAnchor): boolean {
  return anchor.scope.kind === "document" || anchor.scope.kind === "section";
}

const asText = (value: unknown): string =>
  value instanceof Date ? value.toISOString().slice(0, 10) : String(value);

const violationKey = (v: ExtractViolation): string =>
  JSON.stringify([v.path, v.kind, v.rule, v.section, v.target]);

const compare = (a: string | null, b: string | null): number => {
  const left = a ?? "";
  const right = b ?? "";
  return left < right ? -1 : left > right ? 1 : 0;
};

// 계약의 type 순서대로 개체를, 위반은 path·kind·rule·section의 code unit 순으로 낸다.
export function extractAll(
  bundle: BundleContent,
  files: ProjectFiles,
  appData: AppDataReader,
): ExtractResult {
  const types = bundle.contract.types;
  const byName = new Map(types.map((type) => [type.name, type]));

  const cache = new Map<string, ReturnType<DocumentReader>>();
  const rawReader = readDocumentFrom(files);
  const readDocument: DocumentReader = (path) => {
    if (!cache.has(path)) cache.set(path, rawReader(path));
    return cache.get(path) ?? null;
  };

  // from_type이 가리키는 type을 먼저 푼다(선언이 뒤에 있어도). 도는 참조는 빈 개체로 본다.
  const resolved = new Map<string, Resolved>();
  const resolving = new Set<string>();
  const context: KindContext = {
    files,
    readDocument,
    appData,
    anchorsOf: (name) => resolve(name).anchors,
  };

  function resolve(name: string): Resolved {
    const done = resolved.get(name);
    if (done !== undefined) return done;
    const type = byName.get(name);
    if (type === undefined || resolving.has(name)) return EMPTY;
    resolving.add(name);
    const found = runKind(type, context);
    const violations = [...found.violations];
    // 읽을 수 없는 문서의 개체는 만들지 않고 unreadable 위반으로 센다.
    const anchors = found.anchors.filter((anchor) => {
      if (!hasDocument(anchor) || readDocument(anchor.path) !== null) {
        return true;
      }
      violations.push({
        kind: "unreadable",
        rule: null,
        type: name,
        path: anchor.path,
        section: null,
        target: null,
      });
      return false;
    });
    resolving.delete(name);
    const result = { anchors, violations };
    resolved.set(name, result);
    return result;
  }

  // 1) field 값. links field(to_type)는 아직 경로다.
  const entities: ExtractedEntity[] = [];
  const violations: ExtractViolation[] = [];
  for (const type of types) {
    const { anchors, violations: found } = resolve(type.name);
    violations.push(...found);
    for (const anchor of anchors) {
      const fieldContext = {
        ...context,
        anchor,
        document: hasDocument(anchor) ? readDocument(anchor.path) : null,
      };
      const fields: Record<string, unknown> = {};
      for (const field of type.fields) {
        fields[field.name] = readField(field, fieldContext);
      }
      const keyValue = fields[type.key];
      entities.push({
        type: type.name,
        key: keyValue === null || keyValue === undefined
          ? ""
          : asText(keyValue),
        path: anchor.path,
        section: anchor.section,
        fields,
        links: [],
      });
    }
  }

  // 2) 모든 개체가 생긴 뒤 links field의 경로를 to_type 개체의 key로 바꾼다.
  const keysByPath = new Map<string, Map<string, string>>();
  for (const entity of entities) {
    const paths = keysByPath.get(entity.type) ?? new Map<string, string>();
    if (!paths.has(entity.path)) paths.set(entity.path, entity.key);
    keysByPath.set(entity.type, paths);
  }
  for (const entity of entities) {
    const type = byName.get(entity.type)!;
    for (const field of type.fields) {
      if (field.from.kind !== "links" || field.from.to_type === undefined) {
        continue;
      }
      const value = entity.fields[field.name];
      if (!Array.isArray(value)) continue;
      const paths = keysByPath.get(field.from.to_type);
      entity.fields[field.name] = value.flatMap((path) => {
        const key = paths?.get(String(path));
        return key === undefined ? [] : [key];
      });
    }
    // 3) 관계 간선: 선언 순서대로, via 값(list면 항목 순서)마다 하나.
    for (const relation of type.relations) {
      const via = entity.fields[relation.via];
      if (via === null || via === undefined) continue;
      for (const item of Array.isArray(via) ? via : [via]) {
        if (item === null || item === undefined) continue;
        entity.links.push({
          relation: relation.name,
          target_key: asText(item),
        });
      }
    }
  }

  // 같은 파일·종류는 계약 순서로 앞선 type에서 한 번만 센다.
  const seen = new Set<string>();
  const unique = violations.filter((violation) => {
    const key = violationKey(violation);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  unique.sort((a, b) =>
    compare(a.path, b.path) || compare(a.kind, b.kind) ||
    compare(a.rule, b.rule) || compare(a.section, b.section)
  );
  return { entities, violations: unique };
}

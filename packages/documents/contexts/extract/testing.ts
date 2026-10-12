// extract 시험이 함께 쓰는 fixture와 도우미. 제품 코드는 import하지 않는다.
import {
  type BundleContent,
  bundleContentSchema,
  type ContractField,
  type ContractSource,
  type ContractType,
} from "../../../contracts/documents/mod.ts";
import { readDocumentFrom } from "./document.ts";
import type {
  AppDataReader,
  EntityAnchor,
  ExtractedEntity,
  ExtractViolation,
  FieldContext,
  KindContext,
  ProjectFiles,
  SourceKind,
  TypeOfKind,
} from "./types.ts";

const TESTDATA = new URL("../testdata/", import.meta.url);

function walk(directory: URL, prefix: string, found: string[]) {
  for (const entry of Deno.readDirSync(directory)) {
    if (entry.isDirectory) {
      walk(
        new URL(`${entry.name}/`, directory),
        `${prefix}${entry.name}/`,
        found,
      );
    } else found.push(`${prefix}${entry.name}`);
  }
}

export function inlineFiles(files: Record<string, string>): ProjectFiles {
  const paths = Object.keys(files).sort();
  return {
    paths: () => paths,
    read: (path) => files[path] ?? null,
  };
}

// testdata/<name>/ 아래 파일 전부.
export function loadFixture(name: string): ProjectFiles {
  const root = new URL(`${name}/`, TESTDATA);
  const paths: string[] = [];
  walk(root, "", paths);
  paths.sort();
  return {
    paths: () => paths,
    read: (path) =>
      paths.includes(path) ? Deno.readTextFileSync(new URL(path, root)) : null,
  };
}

const readJson = (path: string): unknown =>
  JSON.parse(Deno.readTextFileSync(new URL(path, TESTDATA)));

// testdata/<name>.contract.json
export function loadContract(name: string): BundleContent {
  return bundleContentSchema.parse(readJson(`${name}.contract.json`));
}

// testdata/<name>.app-data.json: "<app> <command>" → 명령 결과
export function loadAppData(name: string): AppDataReader {
  const results = readJson(`${name}.app-data.json`) as Record<string, unknown>;
  return (app, command) => results[`${app} ${command}`];
}

export function loadExpected(
  name: string,
): { entities: ExtractedEntity[]; violations: ExtractViolation[] } {
  return {
    entities: readJson(`expected/${name}.entities.json`) as ExtractedEntity[],
    violations: readJson(
      `expected/${name}.extract-violations.json`,
    ) as ExtractViolation[],
  };
}

// 계약 JSON 조각으로 묶음을 만든다(빠진 값은 스키마 기본값).
export function bundleOf(types: readonly unknown[]): BundleContent {
  return bundleContentSchema.parse({ schema: 1, contract: { types } });
}

export function noAppData(): AppDataReader {
  return () => undefined;
}

export function kindContext(
  files: ProjectFiles,
  options: {
    appData?: AppDataReader;
    anchors?: Record<string, readonly EntityAnchor[]>;
  } = {},
): KindContext {
  return {
    files,
    readDocument: readDocumentFrom(files),
    appData: options.appData ?? noAppData(),
    anchorsOf: (typeName) => options.anchors?.[typeName] ?? [],
  };
}

// anchor의 문서(document·section scope)를 읽어 field context를 만든다.
export function fieldContext(
  files: ProjectFiles,
  anchor: EntityAnchor,
  options: Parameters<typeof kindContext>[1] = {},
): FieldContext {
  const context = kindContext(files, options);
  const hasDocument = anchor.scope.kind === "document" ||
    anchor.scope.kind === "section";
  return {
    ...context,
    anchor,
    document: hasDocument ? context.readDocument(anchor.path) : null,
  };
}

// 계약에서 type 하나를 꺼내 source kind를 좁힌다.
export function typeOf<K extends SourceKind>(
  bundle: BundleContent,
  name: string,
  kind: K,
): TypeOfKind<K> {
  const type = bundle.contract.types.find((candidate) =>
    candidate.name === name
  );
  if (type === undefined || type.source.kind !== kind) {
    throw new Error(`${name} is not a ${kind} type`);
  }
  return type as TypeOfKind<K>;
}

// 시험용 source로 type을 만든다. field는 kind 시험에서 쓰지 않으므로 비어 있다.
export function typeWith<S extends ContractSource>(
  name: string,
  source: S,
): Omit<ContractType, "source"> & { source: S } {
  return {
    name,
    summary: name,
    visibility: "private",
    source,
    key: "id",
    fields: [],
    relations: [],
    rules: [],
  };
}

export function fieldOf(
  name: string,
  value_type: ContractField["value_type"],
  extra: Partial<ContractField> = {},
): ContractField {
  return {
    name,
    from: { kind: "title" },
    value_type,
    required: false,
    visibility: "private",
    ...extra,
  };
}

// 문서 개체(docs·series·index)의 anchor. captures에 file과 path를 더한다.
export function documentAnchor(
  type: string,
  path: string,
  captures: Record<string, string> = {},
): EntityAnchor {
  return {
    type,
    path,
    section: null,
    captures: {
      ...captures,
      file: path.slice(path.lastIndexOf("/") + 1).replace(/\.[^.]+$/, ""),
      path,
    },
    scope: { kind: "document" },
  };
}

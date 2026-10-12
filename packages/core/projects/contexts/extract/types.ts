// 계약(kind·field)으로 Project 파일에서 개체를 뽑는 순수 함수들이 함께 쓰는 모양.
// 규칙의 뜻은 docs/domain-model/documents/contexts.md의 "추출 규칙"이다.
import type {
  ContractField,
  ContractSource,
  ContractType,
  FieldFrom,
} from "../../../../protocol/projects/mod.ts";

// ---------- 입력 ----------

// 한 시점의 Project 파일. 추출은 이것만 읽는다(디스크·시각·난수 없음).
export type ProjectFiles = {
  // Project 기준 상대 경로(`/` 구분), code unit 순으로 정렬. 폴더는 없고 파일만 있다.
  paths(): readonly string[];
  // 파일 글. 없으면 null.
  read(path: string): string | null;
};

// 앱의 read 명령 결과. 돌려줄 결과가 없으면 undefined.
export type AppDataReader = (app: string, command: string) => unknown;

// ---------- 문서 ----------

// md outline parser(`packages/contracts/documents/outline-markdown.ts`의
// `parseOutline`)가 body에서 찾은 제목 하나. 추출은 제목을 이 parser에서만 얻는다.
export type Heading = {
  level: number; // 1~6
  title: string;
  // `ParsedDocument.body`를 `\n`으로 나눈 줄의 0부터 센 번호
  line: number;
};

export type ParsedDocument = {
  // 글 앞머리 `---` 칸의 YAML 객체. 없으면 {}.
  frontmatter: Record<string, unknown>;
  // `.yaml`·`.yml` 파일을 통째로 읽은 값. 다른 파일은 null.
  data: unknown;
  // frontmatter를 뺀 나머지 글. `.yaml` 파일은 "".
  body: string;
  headings: readonly Heading[];
};

// body의 줄 범위. start부터 end 앞까지(end 제외).
export type LineRange = { start: number; end: number };

// 문서를 읽는다. 없거나 읽을 수 없으면 null.
export type DocumentReader = (path: string) => ParsedDocument | null;

// ---------- 개체 ----------

// Source가 field를 채우기 전에 내는 개체의 자리.
export type EntityAnchor = {
  type: string;
  // 개체의 파일. folder는 폴더, app-data는 `app:<app>/<command>`.
  path: string;
  // section·outline 개체에서 heading 글, 나머지는 null
  section: string | null;
  // path capture 값. series는 번호 자리 이름(n, major, minor, patch), folder는 folder,
  // 문서가 있는 개체는 file(확장자 뺀 이름)과 path.
  captures: Record<string, string>;
  scope: AnchorScope;
};

// field가 값을 찾을 범위.
export type AnchorScope =
  | { kind: "folder" }
  | { kind: "document" }
  | { kind: "section"; heading: Heading }
  | { kind: "item"; item: unknown };

export type ExtractedEntity = {
  type: string;
  key: string;
  path: string;
  section: string | null;
  fields: Record<string, unknown>;
  links: { relation: string; target_key: string }[];
};

// 순수 함수가 내는 위반. 검사(checks)가 내는 `rule` 위반은 여기 없다.
export type ExtractViolation = {
  kind: "unreadable" | "path_mismatch" | "broken_link";
  rule: null;
  type: string;
  path: string;
  section: string | null;
  target: string | null;
};

export type ExtractResult = {
  entities: ExtractedEntity[];
  violations: ExtractViolation[];
};

// ---------- kind ----------

export type SourceKind = ContractSource["kind"];
export type TypeOfKind<K extends SourceKind> =
  & Omit<ContractType, "source">
  & { source: Extract<ContractSource, { kind: K }> };

// kind가 쓰는 것. 모두 run이 주거나 시험이 채운다.
export type KindContext = {
  files: ProjectFiles;
  readDocument: DocumentReader;
  appData: AppDataReader;
  // from_type·to_type이 가리키는 type의 읽을 수 있는 개체 자리(개체 순서대로)
  anchorsOf(typeName: string): readonly EntityAnchor[];
};

export type KindResult = {
  anchors: EntityAnchor[];
  violations: ExtractViolation[];
};

export type KindExtractor<K extends SourceKind> = (
  type: TypeOfKind<K>,
  context: KindContext,
) => KindResult;

// ---------- field ----------

export type FieldFromKind<K extends FieldFrom["kind"]> = Extract<
  FieldFrom,
  { kind: K }
>;

// document는 anchor가 문서를 가질 때(document·section scope)만 있다.
export type FieldContext = KindContext & {
  anchor: EntityAnchor;
  document: ParsedDocument | null;
};

// 값을 꺼낸다. 값이 없으면 null(undefined는 쓰지 않는다).
export type FieldReader<K extends FieldFrom["kind"]> = (
  from: FieldFromKind<K>,
  context: FieldContext,
) => unknown;

// YAML이 읽은 값을 field의 value_type에 맞춘다. 맞출 수 없으면 그대로 둔다.
export type FieldCoercer = (field: ContractField, raw: unknown) => unknown;

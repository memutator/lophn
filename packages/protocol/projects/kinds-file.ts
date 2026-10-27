// kind 파일(`kinds.yaml`)의 schema와 순수 검사. yaml 문법과 실제 파일 목록이 필요한 판정(`kinds_syntax`,
// `glob_overlap`)은 core가 내고, 여기는 파일 내용만으로 정해지는 구조 검사만 한다.
import { z } from "zod";

export const kindsIndexPath = (dataRoot: string): string =>
  `${dataRoot}/derived/kinds.sqlite`;

export const KIND_FIELD_TYPES = [
  "string",
  "number",
  "boolean",
  "date",
  "enum",
  "ref",
] as const;

const NAME = /^[a-z][a-z0-9_]{0,39}$/;
// 모든 item에 늘 있는 칸이라 사람이 칸으로 선언할 수 없다.
const RESERVED_FIELDS = ["path", "file"];

export const kindNameSchema = z.string().regex(NAME);
export const fieldNameSchema = z
  .string()
  .regex(NAME)
  .refine((name) => !RESERVED_FIELDS.includes(name), {
    message: "path and file are reserved field names",
  });
// 조건·정렬·집계가 가리키는 칸: 선언한 칸이거나 예약 칸.
export const fieldRefSchema = z.string().regex(NAME);

// violation과 오류의 message는 한 줄이다.
export const kindMessageSchema = z
  .string()
  .min(1)
  .regex(/^[^\r\n]+$/);

export const kindFieldSchema = z
  .strictObject({
    type: z.enum(KIND_FIELD_TYPES),
    required: z.boolean().optional(),
    unique: z.boolean().optional(),
    list: z.boolean().optional(),
    values: z.array(z.string().min(1)).min(1).optional(),
    pattern: z.string().min(1).optional(),
    to: kindNameSchema.optional(),
    from: z.literal("path").optional(),
    capture: z.string().min(1).optional(),
  })
  .superRefine((field, ctx) => {
    const need = (ok: boolean, path: string, message: string) => {
      if (!ok) ctx.addIssue({ code: "custom", path: [path], message });
    };
    need(
      (field.type === "enum") === (field.values !== undefined),
      "values",
      "values is for enum fields only, and enum needs it",
    );
    need(
      (field.type === "ref") === (field.to !== undefined),
      "to",
      "to is for ref fields only, and ref needs it",
    );
    need(
      field.pattern === undefined || field.type === "string",
      "pattern",
      "pattern is for string fields only",
    );
    need(
      (field.from !== undefined) === (field.capture !== undefined),
      "capture",
      "capture goes with from: path",
    );
    need(
      field.from === undefined || field.list !== true,
      "list",
      "a path capture is one value, so it cannot be a list",
    );
  });
export type KindField = z.infer<typeof kindFieldSchema>;

export const kindSchema = z.strictObject({
  name: kindNameSchema,
  summary: z
    .string()
    .max(200)
    .regex(/^[^\r\n]*\S[^\r\n]*$/),
  files: z.array(z.string().min(1)).min(1).max(20),
  // 칸 이름이거나 예약 칸(path, file). 선언 여부는 checkKindsStructure가 본다.
  key: z.string().regex(NAME),
  fields: z.record(fieldNameSchema, kindFieldSchema).default({}),
});
export type Kind = z.infer<typeof kindSchema>;

export const kindsFileSchema = z.strictObject({
  kinds: z.array(kindSchema).min(1).max(50),
});
export type KindsFile = z.infer<typeof kindsFileSchema>;

export const DOCUMENT_RULES = [
  "unreadable",
  "required",
  "type",
  "enum",
  "pattern",
  "unique",
  "ref",
  "overlap",
] as const;
export const KINDS_FILE_RULES = [
  "kinds_syntax",
  "duplicate_kind",
  "unknown_kind",
  "bad_key",
  "bad_capture",
  "bad_pattern",
  "bad_glob",
  "duplicate_glob",
  "glob_overlap",
] as const;
export type KindsFileRule = (typeof KINDS_FILE_RULES)[number];

// message에 값 원문을 싣지 않는다(칸 이름과 규칙만).
export const kindsFileErrorSchema = z.strictObject({
  rule: z.enum(KINDS_FILE_RULES),
  kind: z.string().nullable(),
  field: z.string().nullable(),
  message: kindMessageSchema,
});
export type KindsFileError = z.infer<typeof kindsFileErrorSchema>;

// ---------- glob이 가리키는 폴더 ----------

export type KindWatchFolder = { path: string; recursive: boolean };

const isGlobSegment = (segment: string) => /[*?[\]{}()!]/.test(segment);

// 파일 이름 칸(마지막)을 뺀 폴더 칸 중 처음 glob 칸 앞까지가 literal 폴더이고, glob 폴더 칸이나 `**` 이름
// 칸이 있으면 recursive다.
function folderOfGlob(glob: string): KindWatchFolder {
  const segments = glob.split("/");
  const name = segments.pop()!;
  const globAt = segments.findIndex(isGlobSegment);
  if (globAt >= 0) {
    return { path: segments.slice(0, globAt).join("/"), recursive: true };
  }
  return { path: segments.join("/"), recursive: name === "**" };
}

// worker(훑을 폴더)와 host(감시할 폴더)가 같은 값을 쓴다. 같은 폴더는 recursive가 이기고, recursive 폴더
// 아래에 든 폴더는 합쳐 지운다. path의 code unit 순이다.
export function kindWatchFolders(kinds: Kind[]): KindWatchFolder[] {
  const byPath = new Map<string, boolean>();
  for (const glob of kinds.flatMap((kind) => kind.files)) {
    const folder = folderOfGlob(glob);
    byPath.set(
      folder.path,
      byPath.get(folder.path) === true || folder.recursive,
    );
  }
  const deep = [...byPath]
    .filter(([, recursive]) => recursive)
    .map(([path]) => path);
  return [...byPath]
    .filter(
      ([path]) =>
        !deep.some(
          (root) =>
            root !== path && (root === "" || path.startsWith(`${root}/`)),
        ),
    )
    .map(([path, recursive]) => ({ path, recursive }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

// folder가 path(project 기준 파일 경로)를 덮는가. recursive가 아니면 path의 부모 폴더가 folder와 같을 때,
// recursive면 folder 아래 어디든이다.
export function folderCovers(folder: KindWatchFolder, path: string): boolean {
  if (!folder.recursive) {
    return path.slice(0, Math.max(path.lastIndexOf("/"), 0)) === folder.path;
  }
  return folder.path === "" || path.startsWith(`${folder.path}/`);
}

// ---------- 구조 검사 ----------

function badGlob(glob: string): boolean {
  return (
    glob.trim() === "" ||
    glob.startsWith("/") ||
    /^[A-Za-z]:/.test(glob) ||
    glob.includes("\\") ||
    glob.split("/").includes("..")
  );
}

// 순수 함수다. 앞에 맞던 kind를 지우지 않는 규칙이 이 판정에 기댄다. message는 kind·칸 이름과 규칙만 싣는다.
export function checkKindsStructure(file: KindsFile): KindsFileError[] {
  const errors: KindsFileError[] = [];
  const add = (
    rule: KindsFileRule,
    kind: string,
    field: string | null,
    message: string,
  ) => errors.push({ rule, kind, field, message });

  const names = new Set(file.kinds.map((kind) => kind.name));
  const seen = new Set<string>();
  const globOwner = new Map<string, string>();
  for (const kind of file.kinds) {
    if (seen.has(kind.name)) {
      add(
        "duplicate_kind",
        kind.name,
        null,
        `kind ${kind.name} is declared more than once`,
      );
    }
    seen.add(kind.name);

    if (!(kind.key in kind.fields) && !RESERVED_FIELDS.includes(kind.key)) {
      add(
        "bad_key",
        kind.name,
        kind.key,
        `key ${kind.key} is not a declared field`,
      );
    }

    kind.files.forEach((glob, index) => {
      if (badGlob(glob)) {
        add(
          "bad_glob",
          kind.name,
          null,
          `files[${index}] must be a non-empty relative glob without .. or backslash`,
        );
        return;
      }
      const owner = globOwner.get(glob);
      if (owner === undefined) globOwner.set(glob, kind.name);
      else if (owner !== kind.name) {
        add(
          "duplicate_glob",
          kind.name,
          null,
          `files[${index}] is the same glob as kind ${owner}`,
        );
      }
    });

    for (const [name, field] of Object.entries(kind.fields)) {
      if (field.to !== undefined && !names.has(field.to)) {
        add(
          "unknown_kind",
          kind.name,
          name,
          `field ${name} refers to kind ${field.to}, which is not declared`,
        );
      }
      if (field.capture !== undefined) {
        const count = field.capture.split(`{${name}}`).length - 1;
        if (count !== 1) {
          add(
            "bad_capture",
            kind.name,
            name,
            `capture must contain {${name}} exactly once`,
          );
        }
      }
      if (field.pattern !== undefined) {
        try {
          new RegExp(field.pattern);
        } catch {
          add(
            "bad_pattern",
            kind.name,
            name,
            `pattern of field ${name} does not compile`,
          );
        }
      }
    }
  }
  return errors;
}

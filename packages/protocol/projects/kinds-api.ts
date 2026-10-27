// kind 조회·검사 계약. 내장 tool `list`·`check`가 부르는 core 메모리 route 셋이다. handler는 core가 붙이고,
// 답은 kinds worker가 만든다(`kinds-work.ts`).
import { z } from "zod";
import { defineMemory } from "../base/route.ts";
import { idSchema } from "../base/ids.ts";
import { sha256Schema } from "../base/values.ts";
import {
  DOCUMENT_RULES,
  fieldRefSchema,
  kindMessageSchema,
  kindNameSchema,
  KINDS_FILE_RULES,
  kindSchema,
  kindsFileErrorSchema,
} from "./kinds-file.ts";
import { absolutePathSchema } from "./values.ts";

// 문제의 정체성 key는 (source, kind, path, field, rule)이다. message에 문서의 값을 싣지 않는다.
export const violationSchema = z.discriminatedUnion("source", [
  z.strictObject({
    source: z.literal("kinds_file"),
    rule: z.enum(KINDS_FILE_RULES),
    kind: z.string().nullable(),
    path: z.null(),
    field: z.string().nullable(),
    message: kindMessageSchema,
  }),
  z.strictObject({
    source: z.literal("document"),
    rule: z.enum(DOCUMENT_RULES),
    kind: z.string(),
    // domain 그릇의 폴더 기준 상대 경로. 실제 파일 이름이라 이름 규칙을 걸지 않는다.
    path: z.string().min(1),
    field: z.string().nullable(),
    message: kindMessageSchema,
  }),
]);
export type Violation = z.infer<typeof violationSchema>;

export const kindsStatusSchema = z.strictObject({
  file: absolutePathSchema,
  state: z.enum(["none", "valid", "invalid"]),
  // invalid일 때 앞에 맞던 것이 있으면 previous, 없으면 none이다.
  using: z.enum(["current", "previous", "none"]),
  errors: z.array(kindsFileErrorSchema),
  applied_hash: sha256Schema.nullable(),
});
export type KindsStatus = z.infer<typeof kindsStatusSchema>;

// ---------- 조건 ----------

// 재귀(z.lazy)는 JSON schema에서 $ref를 내서 provider마다 받는 쪽이 갈린다. agent tool의 input schema가
// 이것을 쓰므로 tree를 세 층(group, group, leaf)까지만 풀어 쓴다. 층마다 inner가 세 번 들어가 JSON schema
// 크기가 곱으로 늘기 때문이다. 실행하는 쪽의 평가는 깊이 제한이 없어도 된다.
const scalarSchema = z.union([z.string(), z.number(), z.boolean()]);
// leaf와 group을 각각 한 모양으로 둔다(층마다 곱으로 늘기 때문이다).
const leafSchema = z
  .strictObject({
    field: fieldRefSchema,
    op: z.enum([
      "eq",
      "ne",
      "in",
      "lt",
      "lte",
      "gt",
      "gte",
      "contains",
      "exists",
    ]),
    value: z
      .union([scalarSchema, z.array(scalarSchema).min(1).max(100)])
      .optional(),
  })
  .refine((leaf) => (leaf.op === "exists") === (leaf.value === undefined), {
    message: "exists takes no value; other ops need one",
  });
const MAX_TERMS = 20;
const combine = <T extends z.ZodType>(inner: T) =>
  z.union([
    leafSchema,
    z
      .strictObject({
        all: z.array(inner).min(1).max(MAX_TERMS).optional(),
        any: z.array(inner).min(1).max(MAX_TERMS).optional(),
        not: inner.optional(),
      })
      .refine(
        (c) => Object.values(c).filter((v) => v !== undefined).length === 1,
        { message: "give exactly one of all, any, not" },
      ),
  ]);
export const conditionSchema = combine(combine(leafSchema));
export type KindCondition = z.infer<typeof conditionSchema>;

export const aggregateSchema = z
  .strictObject({
    op: z.enum(["count", "sum", "min", "max"]),
    field: fieldRefSchema.optional(),
    as: fieldRefSchema.optional(),
  })
  .refine((a) => a.op === "count" || a.field !== undefined, {
    message: "field is required unless op is count",
    path: ["field"],
  });

// zod .default()를 쓰지 않는다. tool 입력은 파싱 결과가 입력과 달라지면 거절된다. 기본값(limit 50)은
// handler가 적용한다.
export const kindListQuerySchema = z
  .strictObject({
    kind: kindNameSchema,
    where: conditionSchema.optional(),
    sort: z
      .array(
        z.strictObject({
          field: fieldRefSchema,
          dir: z.enum(["asc", "desc"]),
        }),
      )
      .min(1)
      .max(8)
      .optional(),
    fields: z.array(fieldRefSchema).min(1).max(50).optional(),
    limit: z.number().int().min(1).max(200).optional(),
    cursor: z.string().min(1).optional(),
    aggregate: z.array(aggregateSchema).min(1).max(8).optional(),
    group_by: fieldRefSchema.optional(),
  })
  .superRefine((q, ctx) => {
    const bad = (path: string, message: string) =>
      ctx.addIssue({ code: "custom", path: [path], message });
    if (q.aggregate !== undefined) {
      for (const name of ["sort", "fields", "limit", "cursor"] as const) {
        if (q[name] !== undefined) {
          bad(name, `${name} cannot be used with aggregate`);
        }
      }
    } else if (q.group_by !== undefined) {
      bad("group_by", "group_by needs aggregate");
    }
  });
export type KindListQuery = z.infer<typeof kindListQuerySchema>;

export const kindCheckQuerySchema = z.strictObject({
  kind: kindNameSchema.optional(),
  limit: z.number().int().min(1).max(200).optional(),
  cursor: z.string().min(1).optional(),
});
export type KindCheckQuery = z.infer<typeof kindCheckQuerySchema>;

// ---------- route ----------

const count = z.number().int().min(0);
// 읽지 못했거나 type이 맞지 않아 index에서 빠진 문서 수. 0이어도 늘 준다.
const skippedSchema = z.strictObject({ count, reason: z.string() });

const actors = ["user", "agent", "machine"] as const;
const errors = [
  "invalid_input",
  "not_found",
  "unavailable",
  "forbidden",
  "unauthorized",
] as const;

export const kindGet = defineMemory({
  resource: "kinds",
  method: "get",
  name: "kind.get",
  input: z.strictObject({ domain: idSchema("dom") }),
  output: z.strictObject({
    domain: idSchema("dom"),
    status: kindsStatusSchema,
    // 쓰고 있는 kind. 없으면 null.
    kinds: z.array(kindSchema).nullable(),
  }),
  actors,
  errors,
});

// kind 파일이 없으면 not_found, 모르는 kind·칸·맞지 않는 연산은 invalid_input, worker가 없으면 unavailable.
export const kindList = defineMemory({
  resource: "kinds",
  method: "list",
  name: "kind.list",
  input: z.strictObject({
    domain: idSchema("dom"),
    query: kindListQuerySchema,
  }),
  output: z.discriminatedUnion("mode", [
    z.strictObject({
      kind: kindNameSchema,
      mode: z.literal("items"),
      items: z.array(
        z.strictObject({
          key: z.string(),
          path: z.string().min(1),
          fields: z.record(z.string(), z.json()),
        }),
      ),
      total: count,
      next_cursor: z.string().nullable(),
      skipped: skippedSchema,
    }),
    z.strictObject({
      kind: kindNameSchema,
      mode: z.literal("aggregate"),
      groups: z.array(
        z.strictObject({
          group: z.json(),
          values: z.record(
            z.string(),
            z.union([z.number(), z.string(), z.null()]),
          ),
        }),
      ),
      total: count,
      skipped: skippedSchema,
    }),
  ]),
  actors,
  errors,
});

// kind 파일이 없어도 오류가 아니다. 검사할 것이 없다는 사실(status.state "none")과 빈 목록을 돌려준다.
export const kindCheck = defineMemory({
  resource: "kinds",
  method: "check",
  name: "kind.check",
  input: z.strictObject({
    domain: idSchema("dom"),
    query: kindCheckQuerySchema,
  }),
  output: z.strictObject({
    status: kindsStatusSchema,
    violations: z.array(violationSchema),
    total: count,
    next_cursor: z.string().nullable(),
  }),
  actors,
  errors,
});

export const KIND_ROUTES = [kindGet, kindList, kindCheck] as const;

import { z } from "zod";
import { atSchema, idSchema, jsonObjectSchema } from "../server/mod.ts";
import {
  distinct,
  visualObject,
  visualRefKeySchema,
  visualTextSchema,
  visualTitleSchema,
} from "./visual-source.ts";

const finiteNumber = z.number().finite();

export function visualSpecSchemas(strict: boolean) {
  const object = <S extends z.ZodRawShape>(shape: S) =>
    visualObject(strict, shape);
  const column = object({
    key: visualRefKeySchema,
    label: visualTextSchema,
    type: z.enum(["string", "number", "boolean"]),
    unit: visualTextSchema.optional(),
  });
  const cell = z.union([z.string(), finiteNumber, z.boolean(), z.null()]);
  // record parser는 own __proto__를 지운다. row object는 그대로 두고 cell만 검사한다.
  const tableRowSchema = z.custom<
    Record<string, string | number | boolean | null>
  >((value) => {
    if (!jsonObjectSchema.safeParse(value).success) return false;
    return Object.entries(Object.getOwnPropertyDescriptors(value as object))
      .filter(([, descriptor]) => Object.hasOwn(descriptor, "value"))
      .every(([, descriptor]) => cell.safeParse(descriptor.value).success);
  });
  const table = object({
    columns: z.array(column).min(1).max(20),
    rows: z.array(tableRowSchema).max(1000),
  }).superRefine((value, ctx) => {
    if (!distinct(value.columns.map((c) => c.key))) {
      ctx.addIssue({ code: "custom", message: "duplicate column key" });
    }
    const columns = new Map(value.columns.map((c) => [c.key, c.type]));
    value.rows.forEach((row, index) => {
      for (
        const [key, item] of Object.entries(
          Object.getOwnPropertyDescriptors(row),
        ).flatMap(([key, descriptor]) =>
          Object.hasOwn(descriptor, "value")
            ? [[key, descriptor.value] as const]
            : []
        )
      ) {
        const type = columns.get(key);
        if (!type || (item !== null && typeof item !== type)) {
          ctx.addIssue({
            code: "custom",
            path: ["rows", index, key],
            message: "invalid table cell",
          });
        }
      }
    });
  });
  const point = object({
    x: z.union([z.string(), finiteNumber]),
    y: finiteNumber.nullable(),
  });
  const chart = object({
    type: z.enum(["bar", "line", "scatter"]),
    x: object({
      label: visualTextSchema,
      type: z.enum(["category", "number", "time"]),
      unit: visualTextSchema.optional(),
    }),
    y: object({ label: visualTextSchema, unit: visualTextSchema.optional() }),
    series: z.array(object({
      key: visualRefKeySchema,
      label: visualTextSchema,
      points: z.array(point).max(1000),
    })).max(8),
  }).superRefine((value, ctx) => {
    if (!distinct(value.series.map((s) => s.key))) {
      ctx.addIssue({ code: "custom", message: "duplicate series key" });
    }
    if (value.series.reduce((count, s) => count + s.points.length, 0) > 1000) {
      ctx.addIssue({ code: "custom", message: "too many chart points" });
    }
    if (value.type === "scatter" && value.x.type === "category") {
      ctx.addIssue({
        code: "custom",
        message: "scatter requires number or time x",
      });
    }
    value.series.forEach((s, seriesIndex) =>
      s.points.forEach((p, pointIndex) => {
        const valid = value.x.type === "number"
          ? typeof p.x === "number"
          : value.x.type === "time"
          ? atSchema.safeParse(p.x).success
          : typeof p.x === "string";
        if (!valid) {
          ctx.addIssue({
            code: "custom",
            path: ["series", seriesIndex, "points", pointIndex, "x"],
            message: "x does not match axis type",
          });
        }
      })
    );
  });
  const diagram = object({
    nodes: z.array(object({
      key: visualRefKeySchema,
      label: visualTitleSchema,
      description: visualTextSchema.optional(),
    })).max(100),
    edges: z.array(object({
      from: visualRefKeySchema,
      to: visualRefKeySchema,
      label: visualTextSchema.optional(),
    })).max(200),
  }).superRefine((value, ctx) => {
    const keys = value.nodes.map((n) => n.key);
    if (!distinct(keys)) {
      ctx.addIssue({ code: "custom", message: "duplicate node key" });
    }
    const nodes = new Set(keys);
    value.edges.forEach((edge, index) => {
      if (!nodes.has(edge.from) || !nodes.has(edge.to)) {
        ctx.addIssue({
          code: "custom",
          path: ["edges", index],
          message: "missing endpoint",
        });
      }
    });
  });
  // input은 blueprint view 계약의 JSON object다. owner가 scope·release·view,
  // redaction·secret·URL을 검증한다. 임의 문자열 lexical 검사는 하지 않는다.
  const appCard = object({
    app: idSchema("app"),
    release: idSchema("rel"),
    view: visualTextSchema,
    input: jsonObjectSchema,
  });
  return { table, chart, diagram, appCard };
}

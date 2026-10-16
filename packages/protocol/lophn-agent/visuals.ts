import { z } from "zod";
import {
  visualDescriptionSchema,
  visualKeySchema,
  visualObject,
  visualSourceSchemas,
  visualTitleSchema,
} from "./visual-source.ts";
import { visualSpecSchemas } from "./visual-specs.ts";

function schemas(strict: boolean) {
  const object = <S extends z.ZodRawShape>(shape: S) =>
    visualObject(strict, shape);
  const specs = visualSpecSchemas(strict);
  const common = {
    key: visualKeySchema,
    schema_version: z.literal(1),
    title: visualTitleSchema,
    description: visualDescriptionSchema,
    sources: z.array(visualSourceSchemas(strict)),
  };
  const block = z.discriminatedUnion("kind", [
    object({ ...common, kind: z.literal("table"), payload: specs.table }),
    object({ ...common, kind: z.literal("chart"), payload: specs.chart }),
    object({ ...common, kind: z.literal("diagram"), payload: specs.diagram }),
    object({
      ...common,
      kind: z.literal("app_card"),
      payload: specs.appCard,
    }),
  ]);
  return { source: visualSourceSchemas(strict), ...specs, block };
}

const input = schemas(true);
const output = schemas(false);

export const visualBlockInputSchema = input.block;
export const visualBlockSchema = output.block;

export {
  visualDescriptionSchema,
  visualKeySchema,
  visualRefKeySchema,
  visualTextSchema,
  visualTitleSchema,
} from "./visual-source.ts";

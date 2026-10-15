import { z } from "zod";
import { appIdSchema, projectIdSchema } from "./values.ts";

export const placeRefSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("project"), id: projectIdSchema }),
  z.strictObject({ kind: z.literal("app"), id: appIdSchema }),
]);
export const placeRefOutputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("project"), id: projectIdSchema }),
  z.object({ kind: z.literal("app"), id: appIdSchema }),
]);
export type PlaceRef = z.infer<typeof placeRefSchema>;

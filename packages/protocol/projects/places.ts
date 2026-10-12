import { z } from "zod";
import type { Result } from "../../base/mod.ts";
import { definePort, type Seq } from "../platform/mod.ts";
import { type PlaceRef, placeRefOutputSchema } from "./address.ts";
import { revisionSchema, type Slug, slugSchema } from "./values.ts";

export const placeNameSchema = z.object({
  slug: slugSchema,
  reserved_seq: revisionSchema,
}).and(z.union([
  z.object({
    kind: z.literal("project"),
    target: placeRefOutputSchema.options[0].shape.id,
  }),
  z.object({
    kind: z.literal("app"),
    target: placeRefOutputSchema.options[1].shape.id,
  }),
]));
export type PlaceName = z.infer<typeof placeNameSchema>;

// tx.port가 같은 transaction에 묶인 구현을 주입하므로 별도 commit은 없다.
export interface PlaceNameReservation {
  reserve(slug: Slug, place: PlaceRef, reserved_seq: Seq): Result<void>;
  get(slug: Slug): Result<PlaceName | null>;
}

export const placeNameReservation = definePort<PlaceNameReservation>(
  "documents.PlaceNameReservation",
);

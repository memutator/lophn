import { z } from "zod";

const coordinate = z.number().int().min(0).max(32768);
export const rectSchema = z.object({
  x: coordinate,
  y: coordinate,
  width: z.number().int().min(1).max(32768),
  height: z.number().int().min(1).max(32768),
}).strict();
const id = z.string().min(1).max(80).regex(/^[A-Za-z0-9_-]+$/);
export const overlayKindSchema = z.enum([
  "menu",
  "popover",
  "tooltip",
  "dialog",
  "palette",
  "sheet",
  "drag",
  "notification",
]);
export const overlayModelSchema = z.object({
  label: z.string().max(256),
  text: z.string().max(4096).optional(),
  choices: z.array(
    z.object({
      id,
      label: z.string().min(1).max(256),
      disabled: z.boolean().optional(),
    }).strict(),
  ).max(64).refine((items) =>
    new Set(items.map((item) => item.id)).size === items.length
  ),
}).strict();
export const overlayOpenSchema = z.object({
  requestId: id,
  kind: overlayKindSchema,
  anchorRect: rectSchema,
  model: overlayModelSchema,
}).strict();
const identity = { surfaceId: id, generation: z.number().int().positive() };
export const overlayCloseSchema = z.object(identity).strict();
const pointer = {
  pointerId: z.number().int().min(0).max(2147483647),
  x: coordinate,
  y: coordinate,
  bounds: rectSchema,
};
export const overlayResultSchema = z.discriminatedUnion("type", [
  z.object({ ...identity, type: z.literal("selected"), choiceId: id }).strict(),
  z.object({ ...identity, type: z.literal("closed") }).strict(),
  z.object({ ...identity, ...pointer, type: z.literal("pointer") }).strict(),
  z.object({ ...identity, ...pointer, type: z.literal("drag-end") }).strict(),
  z.object({ ...identity, type: z.literal("drag-cancel") }).strict(),
]);
export type OverlayKind = z.infer<typeof overlayKindSchema>;
export type Rect = z.infer<typeof rectSchema>;
export type OverlayOpen = z.infer<typeof overlayOpenSchema>;
export type OverlayIdentity = z.infer<typeof overlayCloseSchema>;
export type OverlayResult = z.infer<typeof overlayResultSchema>;
export type OverlaySurface = OverlayOpen & OverlayIdentity & { rect: Rect };
export type OverlaySnapshot = {
  generation: number;
  bounds: Rect;
  surfaces: OverlaySurface[];
};
export type OverlayOutcome = OverlayIdentity & {
  requestId: string;
  type: "selected" | "closed";
  choiceId?: string;
  reason?:
    | "dismissed"
    | "crashed"
    | "load_failed"
    | "window_closed"
    | "completed"
    | "cancelled";
};
export type OverlayError = {
  code: "invalid_input" | "forbidden" | "conflict" | "unavailable";
  message: string;
};
export type OverlayReply<T> = { ok: true; value: T } | {
  ok: false;
  error: {
    code: "invalid_input" | "forbidden" | "conflict" | "unavailable";
    message: string;
  };
};
export type OverlayDragUpdate = OverlayIdentity & {
  requestId: string;
  type: "pointer";
  bounds: Rect;
};
export type OverlayEvent = OverlaySnapshot | OverlayOutcome | OverlayDragUpdate;
export interface OverlayApi {
  open(input: OverlayOpen): Promise<OverlayReply<OverlayIdentity>>;
  close(input: OverlayIdentity): Promise<OverlayReply<null>>;
  result(input: OverlayResult): Promise<OverlayReply<null>>;
  subscribe(
    listener: (event: OverlayEvent) => void,
    onError: (error: OverlayError) => void,
  ): () => void;
}
export function interactive(kind: OverlayKind): boolean {
  return ["menu", "popover", "palette", "dialog", "sheet"].includes(kind);
}
export function fullBody(kind: OverlayKind): boolean {
  return ["dialog", "palette", "sheet", "drag", "notification"].includes(kind);
}
export function inside(rect: Rect, body: Rect): boolean {
  return rect.x >= body.x && rect.y >= body.y &&
    rect.x + rect.width <= body.x + body.width &&
    rect.y + rect.height <= body.y + body.height;
}

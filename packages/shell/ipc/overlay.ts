import { z } from "zod";

const coordinate = z.number().int().min(0).max(32768);
export const rectSchema = z
  .object({
    x: coordinate,
    y: coordinate,
    width: z.number().int().min(1).max(32768),
    height: z.number().int().min(1).max(32768),
  })
  .strict();
const id = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9_-]+$/);
const overlayKindSchema = z.enum([
  "menu",
  "popover",
  "tooltip",
  "dialog",
  "palette",
  "sheet",
  "drag",
  "notification",
]);
// palette 행 앞의 아이콘 이름. 그림은 overlay가 design에서 고른다.
const PALETTE_ICONS = [
  "tab",
  "document",
  "file",
  "project",
  "app",
  "launcher",
  "screen",
  "terminal",
  "panel",
  "bookmark",
] as const;
// lophn agent의 얼굴. renderer의 AvatarProfile 중 main이 core에서 읽어 줄 수 있는 둘이다(올린 이미지는 renderer만 읽을
// 주소가 있어 이니셜로 갈음한다).
export const avatarProfileSchema = z.discriminatedUnion("kind", [
  z
    .object({ kind: z.literal("icon"), icon: z.string().min(1).max(64) })
    .strict(),
  z
    .object({ kind: z.literal("initial"), text: z.string().min(1).max(8) })
    .strict(),
]);
const overlayModelSchema = z
  .object({
    label: z.string().max(256),
    text: z.string().max(4096).optional(),
    // palette만 쓴다. 켜면 overlay는 검색어를 거르지 않고 연 쪽에 query로 돌려준다.
    search: z.boolean().optional(),
    // notification만 쓴다.
    tone: z.enum(["neutral", "error"]).optional(),
    // notification만 쓴다. 제목 앞의 그림: coding agent harness의 제품 아이콘이나 lophn agent의 avatar.
    lead: z
      .discriminatedUnion("kind", [
        z
          .object({
            kind: z.literal("harness"),
            harness: z.string().min(1).max(64),
          })
          .strict(),
        z
          .object({ kind: z.literal("avatar"), profile: avatarProfileSchema })
          .strict(),
      ])
      .optional(),
    // notification은 앞의 세 choice를 단추로 쓴다.
    choices: z
      .array(
        z
          .object({
            id,
            label: z.string().min(1).max(256),
            disabled: z.boolean().optional(),
            // palette 묶음 이름·보조 글·키 이름·아이콘. 다른 표면은 그리지 않는다.
            group: z.string().min(1).max(64).optional(),
            detail: z.string().max(256).optional(),
            hint: z.string().max(32).optional(),
            icon: z.enum(PALETTE_ICONS).optional(),
            // icon 대신 그릴 작은 이미지(browser favicon). data URL만 받는다.
            image: z.string().max(65536).startsWith("data:image/").optional(),
          })
          .strict(),
      )
      .max(64)
      .refine(
        (items) => new Set(items.map((item) => item.id)).size === items.length,
      ),
  })
  .strict();
export const overlayOpenSchema = z
  .object({
    requestId: id,
    kind: overlayKindSchema,
    anchorRect: rectSchema,
    model: overlayModelSchema,
  })
  .strict();
const identity = { surfaceId: id, generation: z.number().int().positive() };
export const overlayCloseSchema = z.object(identity).strict();
// 연 쪽이 검색어에 맞춰 palette 행을 바꾼다. 같은 표면·generation에만 적용한다.
export const overlayUpdateSchema = z
  .object({
    ...identity,
    model: overlayModelSchema,
  })
  .strict();
const pointer = {
  pointerId: z.number().int().min(0).max(2147483647),
  x: coordinate,
  y: coordinate,
  bounds: rectSchema,
};
export const overlayResultSchema = z.discriminatedUnion("type", [
  z.object({ ...identity, type: z.literal("selected"), choiceId: id }).strict(),
  z.object({ ...identity, type: z.literal("closed") }).strict(),
  z
    .object({
      ...identity,
      type: z.literal("query"),
      text: z.string().max(256),
    })
    .strict(),
  z.object({ ...identity, ...pointer, type: z.literal("pointer") }).strict(),
  z.object({ ...identity, ...pointer, type: z.literal("drag-end") }).strict(),
  z.object({ ...identity, type: z.literal("drag-cancel") }).strict(),
]);
export type OverlayKind = z.infer<typeof overlayKindSchema>;
export type Rect = z.infer<typeof rectSchema>;
export type OverlayOpen = z.infer<typeof overlayOpenSchema>;
export type OverlayIdentity = z.infer<typeof overlayCloseSchema>;
export type OverlayModel = z.infer<typeof overlayModelSchema>;
export type OverlayLead = NonNullable<OverlayModel["lead"]>;
export type AvatarFace = z.infer<typeof avatarProfileSchema>;
type OverlayUpdate = z.infer<typeof overlayUpdateSchema>;
export type PaletteIcon = (typeof PALETTE_ICONS)[number];
export type OverlayResult = z.infer<typeof overlayResultSchema>;
export type OverlaySurface = OverlayOpen &
  OverlayIdentity & {
    rect: Rect;
  };
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
export type OverlayReply<T> =
  | { ok: true; value: T }
  | {
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
/** 검색 palette에서 사람이 고친 검색어. 표면은 열린 채다. */
export type OverlayQuery = OverlayIdentity & {
  requestId: string;
  type: "query";
  text: string;
};
/** scrim을 까는 표면(modal dialog·palette)이 떠 있는지. shell renderer가 상단 바를 같이 덮는다. */
export type OverlayModal = { type: "modal"; open: boolean };
export type OverlayEvent =
  | OverlaySnapshot
  | OverlayOutcome
  | OverlayDragUpdate
  | OverlayQuery
  | OverlayModal;
export interface OverlayApi {
  open(input: OverlayOpen): Promise<OverlayReply<OverlayIdentity>>;
  close(input: OverlayIdentity): Promise<OverlayReply<null>>;
  update(input: OverlayUpdate): Promise<OverlayReply<null>>;
  result(input: OverlayResult): Promise<OverlayReply<null>>;
  subscribe(
    listener: (event: OverlayEvent) => void,
    onError: (error: OverlayError) => void,
  ): () => void;
}
export function interactive(kind: OverlayKind): boolean {
  return ["menu", "popover", "palette", "dialog", "sheet"].includes(kind);
}
/** backdrop(scrim)을 까는 표면. sheet는 backdrop이 없다. */
export function modal(kind: OverlayKind): boolean {
  return kind === "dialog" || kind === "palette";
}
// menu·popover도 본문 전체를 덮는다. 크기를 어림하지 않고 Radix가 trigger 자리에서 본문 안으로 뒤집고 밀게 한다.
export function fullBody(kind: OverlayKind): boolean {
  return [
    "menu",
    "popover",
    "dialog",
    "palette",
    "sheet",
    "drag",
    "notification",
  ].includes(kind);
}
export function inside(rect: Rect, body: Rect): boolean {
  return (
    rect.x >= body.x &&
    rect.y >= body.y &&
    rect.x + rect.width <= body.x + body.width &&
    rect.y + rect.height <= body.y + body.height
  );
}

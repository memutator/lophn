import { z } from "zod";
import { AGENT_CHARACTER_COLORS } from "../base/character-colors.ts";

// 기본 character는 shape·color만 저장하고 shell이 SVG로 그린다.
// 올린 이미지 이름은 `avatar.<ext>` 하나뿐이라 경로를 실을 수 없고 svg는 받지 않는다.
export const AGENT_CHARACTER_SHAPES = [
  "square",
  "capsule",
  "wide",
  "pear",
  "round",
  "arch",
] as const;
export { AGENT_CHARACTER_COLORS };
export const characterAvatarFields = {
  kind: z.literal("character"),
  shape: z.enum(AGENT_CHARACTER_SHAPES),
  color: z.enum(AGENT_CHARACTER_COLORS),
};
export const characterAvatarSchema = z.strictObject(characterAvatarFields);
export type CharacterAvatar = z.infer<typeof characterAvatarSchema>;
export const DEFAULT_AGENT_CHARACTER = {
  kind: "character",
  shape: "arch",
  color: "sage",
} as const satisfies CharacterAvatar;

export const AGENT_AVATAR_IMAGE_MAX_BYTES = 1_048_576;
export const AGENT_AVATAR_IMAGE_TYPES = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
} as const;
export const agentAvatarImageTypeSchema = z.enum(
  Object.keys(AGENT_AVATAR_IMAGE_TYPES) as [
    keyof typeof AGENT_AVATAR_IMAGE_TYPES,
    ...(keyof typeof AGENT_AVATAR_IMAGE_TYPES)[],
  ],
);

const imageNameSchema = z.string().regex(/^avatar\.(png|jpg|webp)$/);

const avatarImageSchema = z.strictObject({
  kind: z.literal("image"),
  image: imageNameSchema,
});
export const avatarImageOutputSchema = z.object({
  kind: z.literal("image"),
  image: imageNameSchema,
});

export const avatarSchema = z.discriminatedUnion("kind", [
  characterAvatarSchema,
  avatarImageSchema,
]);
export const avatarOutputSchema = z.discriminatedUnion("kind", [
  z.object(characterAvatarFields),
  avatarImageOutputSchema,
]);
export type AgentAvatar = z.infer<typeof avatarSchema>;

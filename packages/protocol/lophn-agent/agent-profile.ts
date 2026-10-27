import { z } from "zod";

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
export const AGENT_CHARACTER_COLORS = [
  "coral",
  "periwinkle",
  "yellow",
  "sage",
  "lavender",
  "peach",
  "blue",
  "teal",
] as const;
export const characterProfileFields = {
  kind: z.literal("character"),
  shape: z.enum(AGENT_CHARACTER_SHAPES),
  color: z.enum(AGENT_CHARACTER_COLORS),
};
export const characterProfileSchema = z.strictObject(characterProfileFields);
export type CharacterProfile = z.infer<typeof characterProfileSchema>;
export const DEFAULT_AGENT_CHARACTER = {
  kind: "character",
  shape: "arch",
  color: "sage",
} as const satisfies CharacterProfile;

export const AGENT_PROFILE_IMAGE_MAX_BYTES = 1_048_576;
export const AGENT_PROFILE_IMAGE_TYPES = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
} as const;
export const agentProfileImageTypeSchema = z.enum(
  Object.keys(AGENT_PROFILE_IMAGE_TYPES) as [
    keyof typeof AGENT_PROFILE_IMAGE_TYPES,
    ...(keyof typeof AGENT_PROFILE_IMAGE_TYPES)[],
  ],
);

const imageNameSchema = z.string().regex(/^avatar\.(png|jpg|webp)$/);

const profileImageSchema = z.strictObject({
  kind: z.literal("image"),
  image: imageNameSchema,
});
export const profileImageOutputSchema = z.object({
  kind: z.literal("image"),
  image: imageNameSchema,
});

export const profileSchema = z.discriminatedUnion("kind", [
  characterProfileSchema,
  profileImageSchema,
]);
export const profileOutputSchema = z.discriminatedUnion("kind", [
  z.object(characterProfileFields),
  profileImageOutputSchema,
]);
export type Profile = z.infer<typeof profileSchema>;

import { z } from "zod";
import { err, ok, type Result } from "../../base/mod.ts";

// 앱과 project가 같이 쓰는, 사람이 올린 icon 이미지의 값. 경계는 svg·png·webp 64 KiB 이하다.
export const ICON_TYPES = ["image/svg+xml", "image/png", "image/webp"] as const;
export const ICON_MAX_BYTES = 64 * 1024;
// base64 상한은 byte 상한의 4/3(올림)이다.
const ICON_MAX_BASE64 = Math.ceil(ICON_MAX_BYTES / 3) * 4;

const iconTypeSchema = z.enum(ICON_TYPES);

export const iconImageSchema = z.strictObject({
  content_type: iconTypeSchema,
  data: z.string().min(1),
});
export type IconImage = z.infer<typeof iconImageSchema>;

// 읽기 출력. uploaded는 사람이 올린 것이 icon이 되었는지다(Remove 단추가 이것을 본다).
export const iconReadOutputSchema = z.object({
  icon: iconImageSchema.nullable(),
  uploaded: z.boolean(),
});

// 설정 입력의 icon. null이면 올린 icon을 지운다.
export const iconSetSchema = iconImageSchema
  .extend({ data: z.string().min(1).max(ICON_MAX_BASE64) })
  .nullable();
export const iconSetOutputSchema = z.strictObject({ uploaded: z.boolean() });

function bytesOf(data: string): Uint8Array | null {
  try {
    return Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

const startsWith = (bytes: Uint8Array, head: readonly number[], at = 0) =>
  head.every((byte, index) => bytes[at + index] === byte);

// 선언한 type과 실제 바이트가 맞는지 앞부분만 본다. 이미지로 그려지지 않는 것을 막는 정도다.
function sniffs(type: IconImage["content_type"], bytes: Uint8Array): boolean {
  if (type === "image/png") {
    return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  }
  if (type === "image/webp") {
    return (
      startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
      startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
    );
  }
  const head = new TextDecoder().decode(bytes.slice(0, 1024));
  return head.includes("<svg");
}

/** 올린 icon을 검사한다. type이 허용 밖이거나 64 KiB를 넘거나 바이트가 type과 다르면 invalid_input이다. */
export function checkIconUpload(icon: {
  content_type: string;
  data: string;
}): Result<IconImage> {
  const type = iconTypeSchema.safeParse(icon.content_type);
  if (!type.success) {
    return err({
      code: "invalid_input",
      message: "icon must be svg, png or webp",
    });
  }
  if (icon.data.length > ICON_MAX_BASE64) {
    return err({ code: "invalid_input", message: "icon is over 64 KiB" });
  }
  const bytes = bytesOf(icon.data);
  if (bytes === null || bytes.byteLength === 0) {
    return err({ code: "invalid_input", message: "icon is not valid base64" });
  }
  if (bytes.byteLength > ICON_MAX_BYTES) {
    return err({ code: "invalid_input", message: "icon is over 64 KiB" });
  }
  if (!sniffs(type.data, bytes)) {
    return err({
      code: "invalid_input",
      message: "icon bytes do not match its type",
    });
  }
  return ok({ content_type: type.data, data: icon.data });
}

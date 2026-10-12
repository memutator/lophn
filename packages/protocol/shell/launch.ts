import { z } from "zod";
import { ID_PREFIXES, idSchema } from "../base/ids.ts";

const ULID = "[0-7][0-9a-hjkmnp-tv-z]{25}";

// 확인할 것의 대상 화면을 연다. confirmation window를 직접 열지 않는다.
export const thingsToConfirmLinkSchema = z.string().regex(
  new RegExp(
    `^lophn://things-to-confirm/(?:${
      Object.keys(ID_PREFIXES).join("|")
    })_${ULID}$`,
  ),
);

export type ThingsToConfirmLink = z.infer<typeof thingsToConfirmLinkSchema>;

export const OPEN_APP_FLAG = "--open-app";
export const TRAY_FLAG = "--tray";
export const QUIT_FLAG = "--quit";

// 실행 인자로 받는 intent. 앱 코드·경로·token·port는 실리지 않는다.
export const launchIntentSchema = z.discriminatedUnion("flag", [
  z.strictObject({ flag: z.literal(OPEN_APP_FLAG), app: idSchema("app") }),
  z.strictObject({ flag: z.literal(TRAY_FLAG) }),
  z.strictObject({ flag: z.literal(QUIT_FLAG) }),
]);

export type LaunchIntent = z.infer<typeof launchIntentSchema>;

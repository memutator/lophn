import { assert, assertEquals } from "@std/assert";
import {
  type LaunchIntent,
  launchIntentSchema,
  OPEN_APP_FLAG,
  QUIT_FLAG,
  thingsToConfirmLinkSchema,
  TRAY_FLAG,
} from "./launch.ts";

const APP = "app_01arz3ndektsv4rrffq69g5fav";
const APR = "apr_01arz3ndektsv4rrffq69g5fav";

Deno.test(
  "shell/app-frame#R7, shell/terminal#R10: 창 열기 링크와 실행 intent는 정해진 모양만 받는다",
  () => {
    assert(
      thingsToConfirmLinkSchema.safeParse(`lophn://things-to-confirm/${APR}`)
        .success,
    );
    assert(
      thingsToConfirmLinkSchema.safeParse(`lophn://things-to-confirm/${APP}`)
        .success,
    );
    assert(
      !thingsToConfirmLinkSchema.safeParse("lophn://things-to-confirm/apr_bad")
        .success,
    );
    assert(
      !thingsToConfirmLinkSchema.safeParse("lophn://things-to-confirm/")
        .success,
    );
    assert(
      !thingsToConfirmLinkSchema.safeParse(`https://things-to-confirm/${APR}`)
        .success,
    );
    const intents: LaunchIntent[] = [
      { flag: OPEN_APP_FLAG, app: APP },
      { flag: TRAY_FLAG },
      { flag: QUIT_FLAG },
    ];
    for (const intent of intents) {
      assert(launchIntentSchema.safeParse(intent).success);
    }
    assertEquals([OPEN_APP_FLAG, TRAY_FLAG, QUIT_FLAG], [
      "--open-app",
      "--tray",
      "--quit",
    ]);
    assert(!launchIntentSchema.safeParse({ flag: "--open-app" }).success);
    assert(
      !launchIntentSchema.safeParse({
        flag: "--open-app",
        app: "doc_01arz3ndektsv4rrffq69g5fav",
      })
        .success,
    );
    assert(
      !launchIntentSchema.safeParse({
        flag: "--open-app",
        app: APP,
        token: "x",
      }).success,
    );
    assert(!launchIntentSchema.safeParse({ flag: "--eval" }).success);
  },
);

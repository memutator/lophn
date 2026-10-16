// `lophn app`: token이 정한 앱 하나를 읽고, test와 preview를 요청한다.
import { type CommandEntry, entryOf } from "./types.ts";

export const APP_COMMANDS: readonly CommandEntry[] = [
  entryOf("app show", "앱 정보를 읽는다"),
  entryOf("app status", "앱 process·preview·release 상태를 읽는다"),
  entryOf("app blueprint", "현재 blueprint의 app-api 선언을 읽는다"),
  entryOf("app invocations", "app-api 호출 이력을 읽는다"),
  entryOf("app logs", "앱 log를 읽는다"),
  entryOf("app test", "앱 test를 요청한다"),
  entryOf("app preview start", "preview를 시작한다"),
  entryOf("app preview stop", "preview를 멈춘다"),
];

// `lophn package`: 의존으로 선언된 package의 안내를 읽기만 한다. 의존 추가는 Project Manager에게 청한다.
import { type CommandEntry, entryOf } from "./types.ts";

export const PACKAGE_COMMANDS: readonly CommandEntry[] = [
  entryOf("package list", "의존 package 목록을 읽는다"),
  entryOf("package show", "package 하나의 안내를 읽는다"),
];

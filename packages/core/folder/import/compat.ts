// 다른 기계와 폴더 꼴 판이 맞는지(범위). 그 기계 기록의 `lophn.folder`로만 본다: 제품 판 글(`lophn.version`)은
// 보이기만 한다(같은 build를 요구하면 한 기계를 올릴 때 나머지가 멈춘다). 범위 밖인 기계는 기록만 읽고 그 기계의
// data·source file을 열지도 복사하지도 지우지도 않는다. 판이 다시 범위 안이면 그 cursor부터 잇는다.
import type { Clock } from "../../../base/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import {
  FOLDER_FORMAT,
  type FolderError,
  type FolderFormat,
} from "../../../protocol/folder/mod.ts";
import { folderError } from "./deps.ts";

/** ok: 주고받는다. update_this: 이 기계의 lophn을 올려야 한다. update_peer: 그 기계의 lophn을 올려야 한다. */
export type Exchange = "ok" | "update_this" | "update_peer";

/**
 * 그 기계의 기록이 알린 꼴 판 범위로. 기록이 `newer_format`이라 읽지 못했으면 부르는 쪽이 `update_this`로 둔다.
 * `own`은 이 기계의 꼴 판이다. 모든 build가 같은 꼴 판인 동안 update_peer 갈래는 test만 본다.
 */
export function exchangeWith(
  peer: FolderFormat,
  own: FolderFormat = FOLDER_FORMAT,
): Exchange {
  // 그 기계가 쓰는 file을 이 기계가 읽는가.
  if (peer.version > own.version) return "update_this";
  if (peer.version < own.min_version) return "update_peer";
  // 이 기계가 쓰는 file을 그 기계가 읽는가.
  if (own.version < peer.min_version) return "update_this";
  if (own.version > peer.version) return "update_peer";
  return "ok";
}

/** 범위 밖인 기계의 읽기 오류. 읽기 명령의 기존 code(`newer_format`)에 누가 올릴지를 message와 details로 싣는다. */
export function exchangeError(
  clock: Clock,
  machine: Id<"mch">,
  name: string,
  exchange: Exclude<Exchange, "ok">,
): FolderError {
  return folderError(
    clock,
    "newer_format",
    exchange === "update_this"
      ? `${name} writes a folder format this lophn cannot read; update lophn on this machine`
      : `${name} runs an older lophn that cannot read this machine's folder; update lophn on ${name}`,
    { machine, exchange },
  );
}

export type MachineExchange = {
  machine: Id<"mch">;
  name: string;
  lophn_version: string | null;
  folder: FolderFormat | null;
  exchange: Exchange;
};

export type HeldDetail = {
  origin: Id<"mch">;
  code_commit: string;
  data_schema: number;
  /** held changes file 안의 변경 수. snapshot은 세지 않는다. */
  changes: number;
  bytes: number;
  /** 그 출처의 held가 한도(`HELD_MAX_BYTES`)에 닿아 더 복사하지 않고 폴더에 둔다. */
  full: boolean;
};

/** `update-status`가 읽는 면. 값이 바뀌면 `onChange`를 부른다. */
export type FolderExchange = {
  /** 알려진 기계와 이 기계(늘 `ok`). */
  machines(): MachineExchange[];
  /** 그 앱의 held를 출처와 release마다 한 줄. */
  held(app: Id<"app">): HeldDetail[];
  /** 앱 기록 사본이 있는 (기계, 앱). 꼴 판이 범위 밖인 기계가 범위 밖이 되기 전에 남긴 옛 사본도 든다. */
  recorded(): { machine: Id<"mch">; app: Id<"app"> }[];
  onChange(listener: () => void): () => void;
};

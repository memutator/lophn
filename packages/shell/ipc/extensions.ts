// Settings › Extensions의 shell IPC 경계. renderer는 목록 읽기와 설치·지우기만 보내고 main이 다시 검사한다.
// 켜기·끄기는 이 통로가 아니라 설정(`extensions.<id>.enabled`) 쓰기다.
// 이 파일은 main·preload·renderer가 함께 부르므로 zod 말고 import가 없다(기여의 모양은 type으로만 가져온다).
import { z } from "zod";
import type { ExtensionContributes } from "../../protocol/extensions/mod.ts";

export const EXTENSIONS_CHANNEL = "shell:extensions";

/** renderer가 부를 수 있는 호출. 이름이 없으면 main이 거절한다. id의 꼴은 registry가 본다. */
export const extensionsCallSchema = z.discriminatedUnion("op", [
  z.strictObject({ op: z.literal("list") }),
  z.strictObject({ op: z.literal("install"), id: z.string().min(1).max(80) }),
  z.strictObject({ op: z.literal("remove"), id: z.string().min(1).max(80) }),
  z.strictObject({ op: z.literal("run"), command: z.string().min(1).max(160) }),
]);

export type ExtensionStatus =
  | "off"
  | "on"
  | "invalid"
  | "incompatible"
  | "no_setting"
  | "failed";

/** registry의 목록 한 줄. */
export interface ExtensionView {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly status: ExtensionStatus;
  /** 문제가 있을 때 이유. */
  readonly reason?: string;
  /** 표시 file이 있다. 없으면 설치 안 됨이다. */
  readonly installed: boolean;
  /** 켜진 extension의 기여(command·key). 꺼져 있으면 없다. */
  readonly contributes?: ExtensionContributes;
}

type ExtensionsFailureCode =
  | "invalid_input"
  | "not_found"
  | "forbidden"
  | "unauthorized"
  | "conflict"
  | "unavailable"
  | "internal";

export type ExtensionsReply<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly error: {
        readonly code: ExtensionsFailureCode;
        readonly message: string;
      };
    };

/** preload가 desktop 창 본문에 여는 통로. */
export interface ExtensionsApi {
  list(): Promise<ExtensionsReply<readonly ExtensionView[]>>;
  install(id: string): Promise<ExtensionsReply<null>>;
  remove(id: string): Promise<ExtensionsReply<null>>;
  /** `ext.<id>.<name>` command를 켜진 extension의 handler로 부른다. */
  run(command: string): Promise<ExtensionsReply<null>>;
}

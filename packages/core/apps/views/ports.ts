import type { Result } from "../../../base/mod.ts";
import type {
  InputSchema,
  SubscriptionDeclaration,
} from "../../../protocol/apps/declaration/mod.ts";
import type { AppViewEventPayload } from "../../../protocol/apps/views.ts";
import type { AppToolCallPath, AppToolLookup } from "../ports.ts";

// view 표가 기대는 port. 구현은 `core/main/daemon/wiring/apps.ts`가 끼운다.

/** 그 release의 고정 선언 가운데 view 표가 쓰는 것. */
export interface ReleaseView {
  bundle_hash: string;
  screens: readonly {
    key: string;
    places: readonly string[];
    params?: InputSchema;
  }[];
  subscriptions: readonly SubscriptionDeclaration[];
}

export interface AppViewsPorts {
  /** 기기 owner(`device:<id>`)의 kind. 기기가 아닌 owner와 모르는 기기는 null. */
  deviceKind(owner: string): "phone" | "computer" | null;
  /** 앱이 없으면 null. */
  appStatus(app: string): Result<"active" | "archived" | null>;
  /** 지금 ready인 live process. 없거나 ready가 아니면 null. */
  live(
    app: string,
  ): Promise<Result<{ release: string; process_nonce: string } | null>>;
  /** 지금 ready인 preview process. 없거나 ready가 아니면 null. */
  preview(app: string): Promise<
    Result<{
      release: string | null;
      bundle_hash: string;
      process_nonce: string;
    } | null>
  >;
  /** 그 앱의 release 선언. 없는 release·다른 앱의 release는 null. */
  release(app: string, release: string): Result<ReleaseView | null>;
  /**
   * 그 view가 폰에서 쓸 수 있는 기능. live는 그 release의 선언 ∩ active grant, preview는 그 preview의 선언이 선언한 것이다
   * (`apps/phone_screens`와 같은 계산).
   */
  phoneCapabilities(
    app: string,
    target:
      | { mode: "live"; release: string }
      | { mode: "preview"; process_nonce: string },
  ): Promise<Result<string[]>>;
  lookup: Pick<AppToolLookup, "find" | "findPreview">;
  path: AppToolCallPath;
  /** 그 앱의 log에 줄 하나를 쓴다. 쓰지 못해도 호출 결과는 그대로다. */
  log(app: string, text: string): void;
  /** `AppViewEvent` 하나를 Bus로 낸다. */
  publish(app: string, payload: AppViewEventPayload): void;
}

// view 하나를 core의 view 표에 묶는다(`app_views/open`). 앱 process(release·bundle·nonce)와 정규화한 params는
// core가 정하고, 화면의 바깥 host는 shell이 grant에서 읽는다. 같은 요청을 다시 보내면 core가 지금 binding을 다시
// 읽어 준다(resume). 다른 기계의 view는 그 기계의 core가 같은 일을 한다(owner는 그 기계가 보는 이 컴퓨터).
import {
  type AppConnector,
  type CoreCaller,
  failure,
  type Outcome,
  type Place,
  type PlaceWorkspace,
  type ViewMode,
} from "./app-connection.ts";
import { appPartition } from "./session-policy.ts";
import type { Bound } from "./view-model.ts";

/** core `app_views/open`의 입력. view id는 shell main이 정한다. */
export interface OpenRequest {
  view: string;
  mode: ViewMode;
  app: string;
  release: string | null;
  screen: string;
  place: Place;
  params?: Record<string, unknown>;
  workspace?: PlaceWorkspace;
}

interface OpenOutput {
  release: string | null;
  bundle_hash: string;
  process_nonce: string;
  phone_capabilities: string[];
  params: NonNullable<Bound["target"]["params"]> | null;
}

// core 오류를 화면 틀 오류로 좁힌다. 범위 밖 앱은 core가 없는 앱과 같게 답하고, 여기서도 앱 중지와 같은
// unavailable로 둔다.
function mapped(error: { code: string; message: string }): Outcome<never> {
  switch (error.code) {
    case "invalid_input":
    case "forbidden":
    case "conflict":
      return failure(error.code, error.message);
    default:
      return failure("unavailable", "app is not available");
  }
}

export async function bindView(
  core: { call: CoreCaller; connector: Pick<AppConnector, "hosts"> },
  machine: string | null,
  request: OpenRequest,
): Promise<Outcome<Bound>> {
  const { call, connector } = core;
  const reply = await call("memory", "app_views", "open", request);
  if (!reply.ok) return mapped(reply.error);
  const opened = reply.value as OpenOutput;
  const hosts = await connector.hosts(request.app, opened.release);
  if (!hosts.ok) return hosts;
  return {
    ok: true,
    value: {
      target: {
        app: request.app,
        mode: request.mode,
        release: opened.release,
        screen: request.screen,
        place: request.place,
        ...(opened.params === null ? {} : { params: opened.params }),
        ...(request.workspace === undefined
          ? {}
          : { workspace: request.workspace }),
      },
      binding: {
        release: opened.release,
        bundleHash: opened.bundle_hash,
        processNonce: opened.process_nonce,
        phoneCapabilities: opened.phone_capabilities,
      },
      hosts: hosts.value,
      partition: appPartition(
        request.app,
        request.mode,
        opened.bundle_hash,
        machine,
      ),
    },
  };
}

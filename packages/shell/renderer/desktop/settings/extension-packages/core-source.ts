// Extensions 화면의 목록·설치·지우기와 켜진 extension의 command는 core route(`extensions/*`)다. extension host는 core 안에서
// 돈다. 켜기·끄기는 설정 쓰기라 SettingsSource가 한다.
import {
  type ExtensionView,
  extensionsInstall,
  extensionsList,
  extensionsRemove,
  extensionsRun,
} from "../../../../../protocol/extensions/routes.ts";
import type { CoreSource } from "../../connection/connection.ts";

export type ExtensionsReply<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly error: { readonly code: string; readonly message: string };
    };

export interface ExtensionsSource {
  list(): Promise<ExtensionsReply<readonly ExtensionView[]>>;
  install(id: string): Promise<ExtensionsReply<null>>;
  remove(id: string): Promise<ExtensionsReply<null>>;
  /** `ext.<id>.<name>` command를 켜진 extension의 handler로 부른다. */
  run(command: string): Promise<ExtensionsReply<null>>;
}

export function coreExtensions(core: CoreSource): ExtensionsSource {
  async function call<T>(
    route: { kind: "read" | "memory"; resource: string; method: string },
    body: unknown,
    pick: (value: unknown) => T,
  ): Promise<ExtensionsReply<T>> {
    const reply = await core.call({
      kind: route.kind,
      resource: route.resource,
      method: route.method,
      body,
    });
    return reply.ok
      ? { ok: true, value: pick(reply.value) }
      : {
          ok: false,
          error: reply.error ?? { code: "internal", message: "failed" },
        };
  }
  const none = () => null;
  return {
    list: () =>
      call(
        extensionsList,
        {},
        (value) => (value as { extensions: ExtensionView[] }).extensions,
      ),
    install: (id) => call(extensionsInstall, { id }, none),
    remove: (id) => call(extensionsRemove, { id }, none),
    run: (command) => call(extensionsRun, { command }, none),
  };
}

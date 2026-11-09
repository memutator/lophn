import { err, ok } from "../../../../base/mod.ts";
import { DIAGNOSTICS_TRACE_SETTING_KEY } from "../../../../protocol/diagnostics/trace.ts";
import {
  settingsList,
  settingsUpdate,
} from "../../../../protocol/config/mod.ts";
import {
  createSettingsReader,
  createSettingsRegistry,
  createSettingsStore,
  type SettingsStore,
  settingsListHandler,
  settingsUpdateHandler,
  shellSettings,
} from "../../../config/mod.ts";
import type { WiringFactory } from "./context.ts";

const key = (route: { resource: string; method: string }) =>
  `${route.resource}/${route.method}`;

// 설정 파일(`<data root>/settings.json`)을 연다. store는 build에서 열어 `settings` 칸을 먼저 낸다
// (approvals처럼 build에서 읽는 wiring이 있다). watch는 start에서 시작한다.
// 선언은 shell 것에 setting-declarations wiring이 `settingDeclarations`로 모은 각 module의 것을 더한다.
export const configWiring: WiringFactory = () => {
  let store: SettingsStore | undefined;
  return {
    name: "config",
    build(ctx) {
      const applyTrace = () =>
        ctx.telemetry.setTrace(
          store?.chosen()[DIAGNOSTICS_TRACE_SETTING_KEY] === true,
        );
      let registry;
      try {
        registry = createSettingsRegistry([
          ...shellSettings,
          ...ctx.settingDeclarations,
        ]);
      } catch (error) {
        return err({
          code: "internal",
          message:
            error instanceof Error ? error.message : "setting declaration",
        });
      }
      store = createSettingsStore({
        root: ctx.root.path,
        registry,
        // Bus는 events가 prepare에서 낸다.
        publish: (keys) => {
          // trace 설정은 log 기록기가 바로 따라야 해서 Bus 구독이 아니라 바뀐 자리에서 적용한다.
          if (keys.includes(DIAGNOSTICS_TRACE_SETTING_KEY)) applyTrace();
          ctx.bus.publish({
            type: "SettingsChanged",
            subject: null,
            at: ctx.clock.now(),
            payload: { keys },
          });
        },
        log: (message) =>
          ctx.telemetry.logger.warn({
            component: "settings",
            event: "store",
            message,
          }),
      });
      applyTrace();
      ctx.provide("settings", createSettingsReader(store));
      const settingsStore = store;
      ctx.provide("settingsUpdate", (changes) => settingsStore.update(changes));
      return ok({
        memory: [
          [key(settingsList), settingsListHandler(store)],
          [key(settingsUpdate), settingsUpdateHandler(store)],
        ],
      });
    },
    start() {
      store?.watch();
      return Promise.resolve(ok(undefined));
    },
    closeIntake() {
      store?.close();
    },
  };
};

import { ok } from "../../../../base/mod.ts";
import { installSdkCopies } from "../../../apps/packages/install.ts";
import { installBuiltinTemplate } from "../../../apps/packages/template/install.ts";
import { installNodeShims } from "../../../supervision/security/node-shims.ts";
import type { WiringFactory } from "./context.ts";

// 이 file 위치에서 본 repo의 `packages/`. 계산은 여기 한 곳에서만 한다.
const PACKAGES_ROOT = new URL("../../../../", import.meta.url).pathname;

// build에서 깐다. prepare는 동기이고 runtime 앞이며, start는 API가 열린 뒤라 그 사이 release 준비 요청이 들어올 수 있다.
// build는 runtime이 열린 뒤 API 앞이고 err를 돌려 기동을 멈출 수 있다.
// node·npm shim도 여기서 쓴다. agent·앱 child가 뜨기 전에 data root에 있어야 shell과 npm script가 쓴다.
export const sdkInstallWiring: WiringFactory = () => ({
  name: "sdk-install",
  async build(ctx) {
    const shims = await installNodeShims(ctx.root.path);
    if (!shims.ok) return shims;
    const sdk = await installSdkCopies({
      dataRoot: ctx.root.path,
      packagesRoot: PACKAGES_ROOT,
    });
    if (!sdk.ok) return sdk;
    const template = await installBuiltinTemplate({ dataRoot: ctx.root.path });
    if (!template.ok) return template;
    return ok({});
  },
});

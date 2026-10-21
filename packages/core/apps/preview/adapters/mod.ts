// preview·test 자식 하나의 broker 서비스 묶음. 외부에 닿는 서비스(net·secret·다른 앱 호출)는
// 모두 대역이다. 예외 경로는 없다(preview와 test의 오류는 앱 log에 쓰지 않는다).
// problems test runner의 mode=test 자식도 같은 묶음을 쓴다(core/problems/tests/work/app-driver.ts).
import type { BrokerServices } from "../../permissions/mod.ts";
import type { PreviewScope } from "../model.ts";
import {
  createPreviewAppsCallService,
  type PreviewAppsCallService,
} from "./apps.ts";
import {
  createPreviewExternalService,
  type PreviewExternalService,
} from "./external.ts";
import {
  createPreviewSecretService,
  type PreviewSecretService,
} from "./secret.ts";

type PreviewBrokerOptions = {
  scope: PreviewScope;
};

type PreviewBrokerServices = {
  services: BrokerServices;
  // 시도한 다른 앱 호출을 보려고 services.appsCall을 따로 쥔다.
  appsCall: PreviewAppsCallService;
  secrets: PreviewSecretService;
  external: PreviewExternalService;
};

export function createPreviewBrokerServices(
  options: PreviewBrokerOptions,
): PreviewBrokerServices {
  const secrets = createPreviewSecretService(options.scope);
  const external = createPreviewExternalService(options.scope);
  const appsCall = createPreviewAppsCallService();
  return {
    services: {
      net: external,
      secrets,
      appsCall,
    },
    appsCall,
    secrets,
    external,
  };
}

export type { PreviewAppsCallService } from "./apps.ts";
export type { PreviewExternalService } from "./external.ts";
export type { PreviewSecretService } from "./secret.ts";
export {
  createPreviewAppsCallService,
  createPreviewExternalService,
  createPreviewSecretService,
};

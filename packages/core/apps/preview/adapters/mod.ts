// preview·test 자식 하나의 broker 서비스 묶음. 외부에 닿는 서비스(net·secret·다른 앱)는 모두
// 대역이고, 운영과 mode로만 구별되는 기록(invocation)·보고(problems) 서비스는 주입받아 그대로 쓴다.
// problems test runner의 mode=test 자식도 같은 묶음을 쓴다.
import type {
  BrokerServices,
  ProblemReportService,
} from "../../permissions/mod.ts";
import type { PreviewScope } from "../model.ts";
import { createPreviewAppsService, type PreviewAppsService } from "./apps.ts";
import {
  createPreviewExternalService,
  type PreviewExternalService,
} from "./external.ts";
import {
  createPreviewSecretService,
  type PreviewSecretService,
} from "./secret.ts";

export type PreviewBrokerOptions = {
  scope: PreviewScope;
  // 보고는 child의 mode와 release로 운영과 구별된다.
  problems?: ProblemReportService;
};

export type PreviewBrokerServices = {
  services: BrokerServices;
  // broker의 `/apps/connect` 서비스 자리에 올리는 대역.
  apps: PreviewAppsService;
  secrets: PreviewSecretService;
  external: PreviewExternalService;
};

export function createPreviewBrokerServices(
  options: PreviewBrokerOptions,
): PreviewBrokerServices {
  const secrets = createPreviewSecretService(options.scope);
  const external = createPreviewExternalService(options.scope);
  const apps = createPreviewAppsService();
  return {
    services: {
      net: external,
      secrets,
      ...(options.problems ? { problems: options.problems } : {}),
    },
    apps,
    secrets,
    external,
  };
}

export type { PreviewAppAttempt, PreviewAppsService } from "./apps.ts";
export type {
  PreviewExternalRequest,
  PreviewExternalService,
} from "./external.ts";
export type { PreviewSecretService, PreviewSecretUse } from "./secret.ts";
export {
  createPreviewAppsService,
  createPreviewExternalService,
  createPreviewSecretService,
};

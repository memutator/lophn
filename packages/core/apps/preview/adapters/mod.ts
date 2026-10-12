// preview·test 자식 하나의 broker 서비스 묶음. 외부에 닿는 서비스(net·secret·문서·다른 앱)는 모두
// 대역이고, 운영과 mode로만 구별되는 기록(invocation)·보고(problems) 서비스는 주입받아 그대로 쓴다.
// problems test runner의 mode=test 자식도 같은 묶음을 쓴다.
import type {
  BrokerServices,
  InvocationBroker,
  ProblemReportService,
} from "../../permissions/mod.ts";
import type { PreviewScope } from "../model.ts";
import { createPreviewAppsService, type PreviewAppsService } from "./apps.ts";
import {
  createPreviewDocumentsService,
  type PreviewDocumentsService,
} from "./documents.ts";
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
  // 기록·보고는 child의 mode와 release로 운영과 구별된다. release가 없는 자식은 invocation을
  // 꾸며 만들지 않는다(invocation broker가 이미 그렇게 한다).
  invocations?: Pick<InvocationBroker, "submit">;
  problems?: ProblemReportService;
};

export type PreviewBrokerServices = {
  services: BrokerServices;
  // broker의 `/apps/connect` 서비스 자리에 올리는 대역.
  apps: PreviewAppsService;
  secrets: PreviewSecretService;
  external: PreviewExternalService;
  documents: PreviewDocumentsService;
};

export function createPreviewBrokerServices(
  options: PreviewBrokerOptions,
): PreviewBrokerServices {
  const secrets = createPreviewSecretService(options.scope);
  const external = createPreviewExternalService(options.scope);
  const documents = createPreviewDocumentsService(options.scope);
  const apps = createPreviewAppsService();
  return {
    services: {
      ...(options.invocations ? { invocations: options.invocations } : {}),
      net: external,
      secrets,
      documents,
      ...(options.problems ? { problems: options.problems } : {}),
    },
    apps,
    secrets,
    external,
    documents,
  };
}

export type { PreviewAppAttempt, PreviewAppsService } from "./apps.ts";
export type { PreviewDocumentsService } from "./documents.ts";
export type {
  PreviewExternalRequest,
  PreviewExternalService,
} from "./external.ts";
export type { PreviewSecretService, PreviewSecretUse } from "./secret.ts";
export {
  createPreviewAppsService,
  createPreviewDocumentsService,
  createPreviewExternalService,
  createPreviewSecretService,
};

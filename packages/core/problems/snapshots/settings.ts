import { z } from "zod";
import { declareSetting } from "../../../protocol/config/mod.ts";

// 진단 상세 수집 on/off. 끄면 새 로그 같은 상세 수집만 멈추고 기존 자료와 필수 invocation 기록은
// 그대로다. collector가 매 접수마다 이 값을 읽는다. 화면 이름은 wording key가 정한다.
export const detailCollectionSetting = declareSetting({
  key: "problems.detail_collection",
  type: z.boolean(),
  default: true,
});

export const DETAIL_COLLECTION_SETTING_KEY = detailCollectionSetting.key;

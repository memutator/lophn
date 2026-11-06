import { ok } from "../../../base/mod.ts";
import { appNoticesList } from "../../../protocol/apps/notice.ts";
import type { ReadDefinition } from "../../../protocol/server/mod.ts";
import { openNotices } from "./store.ts";

export const appNoticesListRead: ReadDefinition<typeof appNoticesList> = {
  route: appNoticesList,
  handle(snapshot) {
    return ok({
      notices: openNotices(snapshot.sql),
      as_of_seq: snapshot.as_of_seq,
      next_cursor: null,
    });
  },
};

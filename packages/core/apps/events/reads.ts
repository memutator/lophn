import { err, ok } from "../../../base/mod.ts";
import { idSchema } from "../../../protocol/base/ids.ts";
import { appEventPublications } from "../../../protocol/apps/events.ts";
import type { ReadDefinition } from "../../../protocol/server/mod.ts";
import { appAccessDenied, authorizeAppId } from "../registration/mod.ts";
import { listPublications } from "./store.ts";

const PAGE = 50;

// 발행 기록은 그 앱의 범위 안에서만 보인다. 범위 밖 앱은 없는 앱과 같다(app.invocations와 같다).
export function createEventPublicationReads(): {
  list: ReadDefinition<typeof appEventPublications>;
} {
  return {
    list: {
      route: appEventPublications,
      handle(snapshot, ctx, input) {
        if (
          input.cursor !== undefined &&
          !idSchema("pub").safeParse(input.cursor).success
        ) {
          return err({ code: "invalid_input", message: "invalid cursor" });
        }
        const access = authorizeAppId(
          snapshot,
          ctx,
          appEventPublications.name,
          input.app,
        );
        if (appAccessDenied(access)) {
          return err({ code: "not_found", message: "app not found" });
        }
        if (!access.ok) return access;
        const limit = input.limit ?? PAGE;
        // 한 개 더 읽어 다음 page가 있는지 본다.
        const rows = listPublications(snapshot.sql, {
          publisher: input.app,
          limit: limit + 1,
          ...(input.event === undefined ? {} : { event: input.event }),
          ...(input.cursor === undefined ? {} : { after: input.cursor }),
        });
        const page = rows.slice(0, limit);
        return ok({
          publications: page,
          as_of_seq: snapshot.as_of_seq,
          next_cursor: rows.length > limit ? page[page.length - 1].id : null,
        });
      },
    },
  };
}

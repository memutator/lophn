// annotation.send. 묶음을 저장하고 받는 쪽(앱이면 App Engineer, artifact이면 domain owner가 정한 쪽, file이면 그 project의 PM)에게 사람 메시지 하나로 보낸다. 보내기는 사람의 동작이라
// Gate를 거치지 않는다. 보관한 앱이면 저장 command가 쓰기 전에 conflict로 거절한다.
import { err, ok, type Result } from "../../../base/mod.ts";
import type { CommandRoute } from "../../../protocol/base/mod.ts";
import type { z } from "zod";
import type {
  Annotation,
  annotationSendInputSchema,
} from "../../../protocol/apps/annotation.ts";
import type {
  AuthenticatedContext,
  Input,
  Output,
} from "../../../protocol/server/mod.ts";
import {
  annotationAddRefs,
  annotationDiscard,
  annotationPersist,
} from "./commands.ts";
import { renderAnnotationMessage } from "./message.ts";
import type { AnnotationDelivery } from "./ports.ts";

// 호출한 사람의 자격으로 command를 낸다. 준비한 blob의 영구 참조 등록이 준비 주체와 같은 자격을 요구한다.
export type RunCommand = <R extends CommandRoute>(
  ctx: AuthenticatedContext,
  route: R,
  input: Input<R>,
  prepared: readonly string[],
) => Promise<Result<Output<R>>>;

type AnnotationDeps = {
  run: RunCommand;
  // 다른 module이 채우는 칸이라 부를 때 읽는다. 없으면 보내기는 unavailable.
  delivery(): AnnotationDelivery | undefined;
};

type SendInput = z.output<typeof annotationSendInputSchema>;

export function createAnnotations(deps: AnnotationDeps) {
  // 묶음을 저장하고 보낼 메시지 글을 만든다.
  async function persist(ctx: AuthenticatedContext, input: SendInput) {
    const persisted = await deps.run(
      ctx,
      annotationPersist,
      { target: input.target, annotations: input.annotations },
      input.annotations.flatMap((item) =>
        item.screenshot === null ? [] : [item.screenshot.preparation],
      ),
    );
    if (!persisted.ok) return persisted;
    const { batch, annotations: ids } = persisted.value;
    const stored: Annotation[] = input.annotations.map((item, i) => ({
      id: ids[i]!,
      batch,
      target: input.target,
      n: item.n,
      kind: item.kind,
      note: item.note,
      screenshot:
        item.screenshot === null
          ? null
          : {
              hash: item.screenshot.hash,
              size_bytes: item.screenshot.size_bytes,
            },
      component: item.component,
      element: item.element,
      rect: item.rect,
      view: item.view,
      release: item.release,
    }));
    return ok({ batch, ids, text: renderAnnotationMessage(stored) });
  }

  // 전달 결과를 받아 마무리한다. 실패하면 방금 저장한 묶음을 지운다.
  async function finish(
    ctx: AuthenticatedContext,
    batch: string,
    ids: readonly string[],
    delivered: Result<{ session: string; message: string }>,
  ) {
    if (!delivered.ok) {
      await deps.run(ctx, annotationDiscard, { batch }, []);
      return delivered;
    }
    const referenced = await deps.run(
      ctx,
      annotationAddRefs,
      {
        annotations: [...ids],
        owner_kind: "session_message",
        owner_id: delivered.value.message,
      },
      [],
    );
    if (!referenced.ok) return referenced;
    return ok({
      batch,
      annotations: [...ids],
      session: delivered.value.session,
      message: delivered.value.message,
    });
  }

  async function send(ctx: AuthenticatedContext, input: SendInput) {
    const delivery = deps.delivery();
    if (delivery === undefined) {
      return err({
        code: "unavailable" as const,
        message: "annotation delivery is not attached",
      });
    }
    const persisted = await persist(ctx, input);
    if (!persisted.ok) return persisted;
    const { batch, ids, text } = persisted.value;
    const { target, session } = input;
    const delivered =
      target.kind === "app"
        ? await delivery.deliver({
            app: target.app,
            session,
            text,
            annotations: ids,
          })
        : target.kind === "artifact"
          ? await delivery.deliverArtifact({
              domain: target.domain,
              name: target.name,
              session,
              text,
              annotations: ids,
            })
          : await delivery.deliverFile({
              project: target.project,
              session,
              text,
              annotations: ids,
            });
    return await finish(ctx, batch, ids, delivered);
  }

  return { send };
}

import { err, ok } from "../../../../base/mod.ts";
import {
  annotationSend,
  annotationUploadScreenshot,
} from "../../../../protocol/apps/annotation.ts";
import type { AuthenticatedContext } from "../../../../protocol/server/mod.ts";
import {
  annotationSweep,
  annotationUploadHandler,
  createAnnotations,
  type RunCommand,
} from "../../../apps/annotations/mod.ts";
import type { WiringFactory } from "./context.ts";

// 오래된 ref 없는 annotation을 지우는 core 안 machine 자격이다. 기록이 없으면 writer가 거절한다.
const ANNOTATIONS_PRINCIPAL = "machine:annotations";
const ANNOTATIONS_CONTEXT: AuthenticatedContext = {
  principal: ANNOTATIONS_PRINCIPAL,
  actor: "machine",
  scope: { operations: [annotationSweep.name], targets: {} },
  conditions: {},
  credential_ref: ANNOTATIONS_PRINCIPAL,
};

const SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;

export const annotationsWiring: WiringFactory = () => {
  let timer: ReturnType<typeof setInterval> | undefined;
  return {
    name: "annotations",
    operations: () => [
      {
        name: annotationSweep.name,
        actors: ["machine"],
        kind: "command",
      },
    ],
    records: () => [ANNOTATIONS_CONTEXT],
    build(ctx) {
      const run: RunCommand = async (caller, route, input, prepared) => {
        const done = await ctx.writer.command(caller, {
          command: route.name,
          input,
          compare: {},
          idempotency_key: crypto.randomUUID(),
          prepared,
        });
        return done.ok ? ok(done.value.result as never) : done;
      };
      // Router가 채우는 칸은 보낼 때 읽는다.
      const annotations = createAnnotations({
        run,
        delivery: () => ctx.peek.annotationDelivery,
      });
      return ok({
        memory: [
          [
            `${annotationSend.resource}/${annotationSend.method}`,
            (caller, raw) => {
              const input = annotationSend.input.safeParse(raw);
              return input.success
                ? annotations.send(caller, input.data)
                : Promise.resolve(
                    err({
                      code: "invalid_input" as const,
                      message: "annotation input is not valid",
                    }),
                  );
            },
          ],
        ],
        uploads: [
          [
            `${annotationUploadScreenshot.resource}/${annotationUploadScreenshot.method}`,
            annotationUploadHandler({ current: ctx.prepareRelay }),
          ],
        ],
      });
    },
    // 시작 때와 하루에 한 번 정리한다.
    start(ctx) {
      const sweep = async () => {
        const done = await ctx.writer.command(ANNOTATIONS_CONTEXT, {
          command: annotationSweep.name,
          input: {},
          compare: {},
          idempotency_key: crypto.randomUUID(),
          prepared: [],
        });
        if (!done.ok) {
          ctx.telemetry.logger.error({
            component: "annotations",
            event: "sweep_failed",
            fields: { code: done.error.code },
          });
        }
      };
      timer = setInterval(sweep, SWEEP_INTERVAL_MS);
      return sweep().then(() => ok(undefined));
    },
    closeWork() {
      if (timer !== undefined) clearInterval(timer);
    },
  };
};

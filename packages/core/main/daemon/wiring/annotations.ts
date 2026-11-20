import { err, ok } from "../../../../base/mod.ts";
import {
  annotationSend,
  annotationUploadScreenshot,
} from "../../../../protocol/apps/annotation.ts";
import type { AuthenticatedContext } from "../../../../protocol/server/mod.ts";
import {
  annotationAddRefs,
  annotationDiscard,
  annotationPersist,
  annotationSweep,
  annotationUploadHandler,
  createAnnotations,
  type RunCommand,
} from "../../../apps/annotations/mod.ts";
import type { WiringFactory } from "./context.ts";

// 오래된 ref 없는 annotation을 지우고, 기기가 보낸 annotation(`annotations/send`)의 내부 저장 command를 대행하는 core 안 machine 자격이다.
const ANNOTATIONS_PRINCIPAL = "machine:annotations";
const ANNOTATIONS_CONTEXT: AuthenticatedContext = {
  principal: ANNOTATIONS_PRINCIPAL,
  actor: "machine",
  scope: {
    operations: [
      annotationSweep.name,
      annotationPersist.name,
      annotationDiscard.name,
      annotationAddRefs.name,
    ],
    targets: {},
  },
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
      {
        name: annotationPersist.name,
        actors: ["user", "machine"],
        kind: "command",
      },
      {
        name: annotationDiscard.name,
        actors: ["user", "machine"],
        kind: "command",
      },
      {
        name: annotationAddRefs.name,
        actors: ["user", "machine"],
        kind: "command",
      },
    ],
    records: () => [ANNOTATIONS_CONTEXT],
    build(ctx) {
      const run: RunCommand = async (caller, route, input, prepared) => {
        // 원격 기기는 route 목록으로 `annotation.send`만 허가받고 내부 저장 command 이름은 scope에 없다.
        // screenshot blob이 없으면 core 안 machine 자격으로 저장을 대행한다(보내는 쪽이 사람임은 route에서 이미 확인됐다).
        const canDirect =
          caller.scope.operations.includes("*") ||
          caller.scope.operations.includes(route.name);
        const as =
          !canDirect && prepared.length === 0 ? ANNOTATIONS_CONTEXT : caller;
        const done = await ctx.writer.command(as, {
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

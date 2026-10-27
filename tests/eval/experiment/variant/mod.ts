import { err, ok, type Result } from "../../../../packages/base/mod.ts";
import {
  bootCore,
  type BootOptions,
  type Core,
  type Run,
} from "../../../support/core/mod.ts";
import type { Deps } from "../../versions/mod.ts";
import { denoIo, type VariantIo } from "./io.ts";
import { prepareVariant } from "./prepare.ts";
import { variantTexts } from "./texts.ts";

export type { RunOutput, VariantIo } from "./io.ts";
export { prepareVariant } from "./prepare.ts";
export { variantTexts } from "./texts.ts";

export type Variant = {
  /** 절대 경로(symlink를 푼 값). 지금 checkout이면 그 root */
  root: string;
  /** checkout을 안 줬거나 지금 checkout과 같은 경로 */
  isCurrent: boolean;
  /** component, core, source를 variant에서 잰다. registryDir과 checksRoot는 늘 지금 checkout이다. */
  versionDeps: Deps;
  /** checks, 시나리오 hash, criterion, judge를 잰다. 늘 지금 checkout이다. */
  graderDeps: Deps;
  boot(run: Run, options?: BootOptions): Promise<Core>;
};

export async function resolveVariant(
  args: { checkout?: string; current: string },
  io: VariantIo = denoIo,
): Promise<Result<Variant>> {
  const current = await io.realPath(args.current);
  // registry는 전역 이름 표라 지금 checkout의 것 하나뿐이다. variant 사본에 쓰면 그 worktree를 지울 때 표가 사라진다.
  const registryDir = `${current}/tests/eval/registry`;
  const graderDeps: Deps = { root: current, registryDir };
  const boot =
    (root: string, isCurrent: boolean): Variant["boot"] =>
    (run, options) =>
      bootCore(run, { ...options, repo: isCurrent ? undefined : root });

  const path =
    args.checkout === undefined
      ? current
      : await io.realPath(args.checkout).catch(() => null);
  if (path === null) {
    return err({
      code: "invalid_input",
      message: `checkout이 없다: ${args.checkout}`,
    });
  }
  if (path === current) {
    return ok({
      root: current,
      isCurrent: true,
      versionDeps: graderDeps,
      graderDeps,
      boot: boot(current, true),
    });
  }

  const top = await io.gitToplevel(path);
  if (top === null || (await io.realPath(top)) !== path) {
    return err({
      code: "invalid_input",
      message: `git checkout의 최상위가 아니다: ${path}`,
    });
  }
  if (!(await io.exists(`${path}/packages/core/main/daemon/main.ts`))) {
    return err({
      code: "invalid_input",
      message: `core 입구가 없다: ${path}/packages/core/main/daemon/main.ts`,
    });
  }
  const prepared = await prepareVariant(path, current, io);
  if (!prepared.ok) return prepared;
  const texts = await variantTexts(path, io);
  if (!texts.ok) return texts;
  return ok({
    root: path,
    isCurrent: false,
    versionDeps: {
      root: path,
      registryDir,
      checksRoot: current,
      texts: texts.value,
    },
    graderDeps,
    boot: boot(path, false),
  });
}

export function explainBreak(
  variant: Variant,
  step: "boot" | "restore",
  cause: string,
): string {
  if (variant.isCurrent) return cause;
  return `variant ${variant.root}의 core로 ${step}하다 멈췄다: ${cause}. 지금 checkout의 protocol·route와 달라서일 수 있다(grader는 지금 checkout의 protocol로 부른다).`;
}

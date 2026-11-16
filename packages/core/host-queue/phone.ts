import { err, type LophnError, ok, type Result } from "../../base/mod.ts";
import {
  BROWSER_WAIT_DEFAULT_MS,
  type BrowserPage,
  browserActSchema,
} from "../../protocol/lophn-agent/host-queue.ts";
import {
  type DriveAct,
  type DriveSnapshotOutput,
  PHONE_TAB_TEXT,
} from "../../protocol/phone/drive.ts";
import { PHONE_KINDS, type PhoneKind } from "../../protocol/phone/kinds.ts";
import type { PhoneTab } from "./queue.ts";

// phone 탭의 browser 호출을 폰 link의 `drive.*`로 바꾼다(`protocol/phone/drive.ts`). 기기와 view는 부를 때마다 그 앱의 열린
// preview view에서 고르고, ref 번호·snapshot 글·오류 문장·redaction은 core가 한다. 폰은 view·by·snapshot id만 받는다.

// 그 앱의 preview view 하나다(`apps/views`의 `previewViews`). owner는 `device:<기기 id>`다.
export type PreviewView = {
  owner: string;
  view: string;
  screen: string;
  used: number;
};

export type PhoneDriveDeps = {
  previewViews(app: string): readonly PreviewView[];
  call(request: {
    device: string;
    kind: PhoneKind;
    input: unknown;
    deadline_ms: number;
  }): Promise<Result<unknown>>;
  // 알려진 값을 아직 다 모르면 null이다.
  redact(text: string): string | null;
};

// 사람 token이 부를 때 폰의 "is driving" 줄에 쓰는 이름이다.
export const PHONE_BY_PERSON = "Someone on your computer";

// desktop snapshot(`shell/main/browser/agent/snapshot.ts`)과 같은 상한과 줄 여유다.
const SNAPSHOT_MAX = 60_000;
const DEVICE = "device:";
const UNCHECKED = "the browser result could not be checked for secrets";

const invalid = (message: string) =>
  err({ code: "invalid_input" as const, message });
const unsupported = (name: string) => invalid(PHONE_TAB_TEXT.unsupported(name));
const notShowing = () =>
  err({ code: "unavailable" as const, message: PHONE_TAB_TEXT.notShowing });
const staleRef = () =>
  err({ code: "conflict" as const, message: PHONE_TAB_TEXT.staleRef });

// 폰 오류의 이유를 정한 문장으로 바꾼다. 그 밖의 오류는 code와 message를 그대로 둔다.
const REASON_TEXT: Partial<Record<string, Record<string, string>>> = {
  unavailable: {
    phone_unreachable: PHONE_TAB_TEXT.notShowing,
    no_preview: PHONE_TAB_TEXT.notShowing,
    phone_in_background: PHONE_TAB_TEXT.notInFront,
    screen_off: PHONE_TAB_TEXT.notInFront,
    unsupported: PHONE_TAB_TEXT.tooOld,
    timeout: PHONE_TAB_TEXT.timedOut,
  },
  conflict: {
    taken_over: PHONE_TAB_TEXT.takenOver,
    stale_ref: PHONE_TAB_TEXT.staleRef,
    off_screen: PHONE_TAB_TEXT.offScreen,
  },
};
function phoneError(error: LophnError): LophnError {
  const reason = error.details?.["reason"];
  const text =
    typeof reason === "string" ? REASON_TEXT[error.code]?.[reason] : undefined;
  return text === undefined ? error : { code: error.code, message: text };
}

// 다룰 view다. 그 screen의 것(null이면 아무 screen) 가운데 가장 최근 쓴 것이다.
function pickView(
  views: readonly PreviewView[],
  screen: string | null,
): PreviewView | null {
  let best: PreviewView | null = null;
  for (const view of views) {
    if (screen !== null && view.screen !== screen) continue;
    if (best === null || view.used > best.used) best = view;
  }
  return best;
}

// 줄 말은 `drive.ts`의 규칙이다. ref는 탭의 counter에서 나와 늘기만 한다. 자른 줄은 ref를 받지 않는다.
function render(
  tab: PhoneTab,
  screen: string,
  answer: DriveSnapshotOutput,
): { text: string; refs: Map<string, number> } {
  const refs = new Map<string, number>();
  const lines = [`screen ${screen} ${answer.width_dp}x${answer.height_dp}dp`];
  let size = lines[0]!.length;
  let truncated = false;
  for (const node of answer.nodes) {
    const name = node.name === "" ? "" : ` ${JSON.stringify(node.name)}`;
    const value =
      node.value === undefined || node.value === ""
        ? ""
        : ` value=${JSON.stringify(node.value)}`;
    const flags = node.flags.map((flag) => ` [${flag}]`).join("");
    const line = `${"  ".repeat(node.depth)}- ${node.role}${name}${value}${flags}`;
    if (size + line.length + 16 > SNAPSHOT_MAX) {
      truncated = true;
      break;
    }
    tab.counter += 1;
    refs.set(`e${tab.counter}`, node.node);
    lines.push(`${line} [ref=e${tab.counter}]`);
    size += line.length + 16;
  }
  if (truncated) lines.push("[truncated]");
  return { text: lines.join("\n"), refs };
}

export function createPhoneDriver(deps: PhoneDriveDeps) {
  const pick = (tab: PhoneTab) =>
    pickView(deps.previewViews(tab.app), tab.screen);

  async function ask<K extends PhoneKind>(
    kind: K,
    chosen: PreviewView,
    by: string,
    input: object,
    deadline_ms: number = PHONE_KINDS[kind].deadline_ms,
  ): Promise<Result<(typeof PHONE_KINDS)[K]["output"]["_output"]>> {
    const answer = await deps.call({
      device: chosen.owner.slice(DEVICE.length),
      kind,
      input: { view: chosen.view, by, ...input },
      deadline_ms,
    });
    if (!answer.ok) return err(phoneError(answer.error));
    const parsed = PHONE_KINDS[kind].output.safeParse(answer.value);
    return parsed.success
      ? ok(parsed.data)
      : err({
          code: "internal",
          message: `the phone answered ${kind} with an unexpected shape`,
        });
  }

  // act·wait·read가 답하는 page다. 화면 key도 앱이 쓴 글이라 redaction을 거친다.
  const page = (tab: PhoneTab, screen: string): Result<BrowserPage> => {
    const url = deps.redact(`phone://${tab.app}/${screen}`);
    const title = deps.redact(screen);
    return url === null || title === null
      ? err({ code: "unavailable", message: UNCHECKED })
      : ok({ url, title });
  };

  return {
    async snapshot(tab: PhoneTab, by: string): Promise<Result<unknown>> {
      const chosen = pick(tab);
      if (chosen === null) return notShowing();
      const answer = await ask("drive.snapshot", chosen, by, {});
      if (!answer.ok) return answer;
      const { text, refs } = render(tab, chosen.screen, answer.value);
      const safe = deps.redact(text);
      if (safe === null)
        return err({ code: "unavailable", message: UNCHECKED });
      tab.last = {
        owner: chosen.owner,
        view: chosen.view,
        snapshot: answer.value.snapshot,
        refs,
      };
      return ok({ snapshot: safe });
    },

    async act(
      tab: PhoneTab,
      by: string,
      input: Record<string, unknown>,
    ): Promise<Result<unknown>> {
      const { tab: _tab, ...fields } = input;
      const parsed = browserActSchema.safeParse(fields);
      if (!parsed.success) {
        return invalid(`invalid act: ${parsed.error.issues[0]?.message ?? ""}`);
      }
      const act = parsed.data;
      if (
        act.type === "hover" ||
        act.type === "select" ||
        act.type === "fill_login"
      ) {
        return unsupported(`act ${act.type}`);
      }
      if (act.type === "press" && act.key !== "Enter") {
        return unsupported(`press ${act.key}`);
      }
      const chosen = pick(tab);
      if (chosen === null) return notShowing();
      // 폰에 묻기 전에 core가 거른다: ref는 이 view의 마지막 snapshot의 것이어야 한다.
      const last = tab.last;
      if (
        last === null ||
        last.owner !== chosen.owner ||
        last.view !== chosen.view
      ) {
        return staleRef();
      }
      let node: number | undefined;
      if (act.ref !== undefined) {
        node = last.refs.get(act.ref);
        if (node === undefined) return staleRef();
      }
      const at = node === undefined ? {} : { node };
      const drive: DriveAct =
        act.type === "click"
          ? { type: "click", node: node! }
          : act.type === "type" || act.type === "fill"
            ? { type: act.type, node: node!, text: act.text }
            : act.type === "press"
              ? { type: "press", key: "Enter", ...at }
              : {
                  type: "scroll",
                  ...at,
                  ...(act.dy === undefined ? {} : { dy: act.dy }),
                };
      const answer = await ask("drive.act", chosen, by, {
        snapshot: last.snapshot,
        act: drive,
      });
      return answer.ok ? page(tab, chosen.screen) : answer;
    },

    async screenshot(tab: PhoneTab, by: string): Promise<Result<unknown>> {
      const chosen = pick(tab);
      if (chosen === null) return notShowing();
      const answer = await ask("drive.screenshot", chosen, by, {
        format: "jpeg",
      });
      if (!answer.ok) return answer;
      const { media_type, data_base64 } = answer.value;
      return ok({ image: { media_type, data_base64 } });
    },

    async wait(
      tab: PhoneTab,
      by: string,
      input: { text?: string; url?: string; timeout_ms?: number },
    ): Promise<Result<unknown>> {
      if (input.url !== undefined) return unsupported("wait --url");
      if (input.text === undefined) return invalid("give text to wait for");
      const chosen = pick(tab);
      if (chosen === null) return notShowing();
      const timeout_ms = input.timeout_ms ?? BROWSER_WAIT_DEFAULT_MS;
      const answer = await ask(
        "drive.wait",
        chosen,
        by,
        { text: input.text, timeout_ms },
        timeout_ms + 5_000,
      );
      if (!answer.ok) return answer;
      // desktop wait(`shell/main/browser/agent/driver.ts`)와 같은 문장이다.
      if (!answer.value.found) {
        return err({
          code: "unavailable",
          message: `The condition did not hold within ${timeout_ms} ms. Run browser snapshot to see the page, then change the condition or wait longer; the same wait will fail the same way.`,
        });
      }
      return page(tab, chosen.screen);
    },

    // 폰에 묻지 않는다.
    read(tab: PhoneTab): Result<unknown> {
      const chosen = pick(tab);
      if (chosen === null) return notShowing();
      const shown = page(tab, chosen.screen);
      return shown.ok ? ok({ ...shown.value, loading: false }) : shown;
    },

    unsupported,
  };
}

export type PhoneDriver = ReturnType<typeof createPhoneDriver>;

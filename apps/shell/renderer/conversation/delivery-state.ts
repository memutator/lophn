// 보낸 말 하나의 전달 상태(shell/desktop#R8). 보내는 중·접수됨·못 보냄·접수 확인 안 됨을
// 구별한다. 결과를 모르면 다시 보내기보다 접수 조회를 먼저 내놓는다. 다시 보낼 때는 같은
// 메시지 id와 idempotency key를 써서 core가 한 번만 접수한다(lophn-agent/conversation#R2).

export type DeliveryPhase = "sending" | "accepted" | "not_sent" | "unconfirmed";

export type SendMode = "request" | "correction";

export interface Outgoing {
  readonly id: string;
  readonly key: string;
  readonly text: string;
  readonly body: string;
  readonly mode: SendMode;
  /** 수정이 가리키는 지금 일. 다음 요청은 null이다. */
  readonly run: string | null;
  readonly phase: DeliveryPhase;
  /** 접수 확인 안 됨에서 조회했으나 찾지 못했다. 그 뒤에야 다시 보내기를 내놓는다. */
  readonly checked: boolean;
}

export type SendReply = { readonly ok: true } | {
  readonly ok: false;
  readonly code: string;
};

/** 사람이 다음에 할 수 있는 일. */
export type DeliveryAction = "wait" | "none" | "edit" | "check" | "resend";

// core가 처리하지 않았다고 답한 오류. 그 밖(unavailable, internal, 통로 실패)은 결과를 모른다.
const NOT_TAKEN = new Set([
  "invalid_input",
  "unauthorized",
  "forbidden",
  "not_found",
  "conflict",
]);

export function startSend(
  input: Omit<Outgoing, "phase" | "checked">,
): Outgoing {
  return { ...input, phase: "sending", checked: false };
}

export function afterReply(outgoing: Outgoing, reply: SendReply): Outgoing {
  if (reply.ok) return { ...outgoing, phase: "accepted" };
  return {
    ...outgoing,
    phase: NOT_TAKEN.has(reply.code) ? "not_sent" : "unconfirmed",
  };
}

/** 접수 조회 결과. 찾으면 접수됨이고, 못 찾으면 다시 보내기를 연다. */
export function afterCheck(outgoing: Outgoing, found: boolean): Outgoing {
  if (outgoing.phase !== "unconfirmed") return outgoing;
  return found
    ? { ...outgoing, phase: "accepted" }
    : { ...outgoing, checked: true };
}

/** 같은 id·key로 다시 보낸다. 조회 전에는 다시 보내지 않는다. */
export function resend(outgoing: Outgoing): Outgoing {
  if (deliveryAction(outgoing) !== "resend") return outgoing;
  return { ...outgoing, phase: "sending", checked: false };
}

export function deliveryAction(outgoing: Outgoing): DeliveryAction {
  switch (outgoing.phase) {
    case "sending":
      return "wait";
    case "accepted":
      return "none";
    case "not_sent":
      return "edit";
    case "unconfirmed":
      return outgoing.checked ? "resend" : "check";
  }
}

/**
 * 입력칸을 잠그는지. 보내는 중이나 결과를 모르는 동안 글을 고치면 같은 말이 두 번
 * 접수될 수 있어 잠근다. 못 보냄은 글이 그대로 남아 고쳐 보낼 수 있다.
 */
export function composerLocked(outgoing: Outgoing | null): boolean {
  return outgoing !== null &&
    (outgoing.phase === "sending" || outgoing.phase === "unconfirmed");
}

/**
 * 본문 hash. 사람 말은 글 part 하나의 MessageContent(schema_version 1)이고 key 순서를
 * 고정한 JSON의 SHA-256 hex다.
 */
export async function textBody(text: string): Promise<string> {
  const canonical = JSON.stringify({
    parts: [{ kind: "text", text }],
    schema_version: 1,
  });
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

// 역할·상태의 화면 말. 원시 enum을 화면에 내보이지 않는다(ui-ux 3절).
import { t } from "@lophn/wording";

import type { Request, Role } from "./source.ts";

export function roleLabel(role: Role): string {
  switch (role) {
    case "lophn":
      return t("things-to-confirm.label.role-lophn");
    case "app_engineer":
      return t("things-to-confirm.label.role-app-engineer");
    case "context_engineer":
      return t("things-to-confirm.label.role-context-engineer");
    case "operator":
      return t("things-to-confirm.label.role-operator");
  }
}

/** 목록·칸의 머리. 역할을 모르면 종류만 말한다. */
export function requestTitle(request: Request): string {
  if (request.kind === "question") {
    return request.role === null
      ? t("things-to-confirm.label.question")
      : t("things-to-confirm.label.question-from", {
        role: roleLabel(request.role),
      });
  }
  return request.role === null
    ? t("things-to-confirm.label.decision")
    : t("things-to-confirm.label.decision-from", {
      role: roleLabel(request.role),
    });
}

export type StatusTone = "neutral" | "warning" | "good" | "serious";

/** 상태 이름과 모양. 색 없이도 글로 읽는다. */
export function statusOf(
  request: Request,
): { readonly label: string; readonly tone: StatusTone } {
  if (request.status === "pending") {
    return {
      label: t("things-to-confirm.label.status-waiting"),
      tone: "warning",
    };
  }
  if (request.status === "expired") {
    return {
      label: t("things-to-confirm.label.status-expired"),
      tone: "neutral",
    };
  }
  if (request.kind === "question") {
    if (request.status === "answered") {
      return {
        label: t("things-to-confirm.label.status-answered"),
        tone: "good",
      };
    }
    if (request.closedReason === "deferred") {
      return {
        label: t("things-to-confirm.label.status-deferred"),
        tone: "neutral",
      };
    }
    if (request.closedReason === "superseded") {
      return {
        label: t("things-to-confirm.label.status-replaced"),
        tone: "neutral",
      };
    }
    return {
      label: t("things-to-confirm.label.status-cancelled"),
      tone: "neutral",
    };
  }
  if (request.status === "granted") {
    return { label: t("things-to-confirm.label.status-allowed"), tone: "good" };
  }
  if (request.status === "rejected") {
    return {
      label: t("things-to-confirm.label.status-declined"),
      tone: "serious",
    };
  }
  return {
    label: t("things-to-confirm.label.status-cancelled"),
    tone: "neutral",
  };
}

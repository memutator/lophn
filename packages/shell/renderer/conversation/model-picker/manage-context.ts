import { createContext, useContext } from "react";

/** Manage models 창을 여는 모양. 기본은 맨 위 묶음 없이 목록만 연다. */
export interface ManageModelsOptions {
  /** 맨 위에 보일 provider 묶음. */
  first?: string;
  /** 창 안 한 줄(provider를 붙이고 목록을 읽은 결과). */
  notice?: string;
  /** 이 provider의 Add model form을 열어 두고, form 맨 위에 이 글을 보인다. */
  addModel?: { provider: string; lead: string };
  /** 창이 닫힌 뒤 부른다. */
  onClosed?: () => void;
}

export interface ManageModelsApi {
  /** Manage models 창을 연다. */
  open(options?: ManageModelsOptions): void;
}

/** 창을 여는 host가 감싼다. null이면(host 밖, 기본 model 대화창 안) picker에 Manage models 줄이 없다. */
export const ManageModelsContext = createContext<ManageModelsApi | null>(null);

export function useManageModels(): ManageModelsApi | null {
  return useContext(ManageModelsContext);
}

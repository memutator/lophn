// 이름이 줄 왼쪽에 있고 입력은 오른쪽 고정 열에 있는 줄을 위한 부품. design의 Input·Select는 Field의
// 라벨이 있어야 해서, 같은 context를 직접 잡아 라벨을 줄 왼쪽에 둔다.
import { type ReactNode, useId } from "react";

import {
  FieldContext,
} from "../../../../../packages/design/components/field/field-context.ts";

export function NamedControl(
  { name, invalid = false, labelClass, children }: {
    readonly name: string;
    readonly invalid?: boolean;
    readonly labelClass: string;
    /** 이름 아래에 놓일 글(도움말, 오류)과 입력을 render prop으로 나눠 받는다. */
    readonly children: (parts: {
      readonly label: ReactNode;
      readonly provide: (control: ReactNode) => ReactNode;
    }) => ReactNode;
  },
) {
  const id = useId();
  const label = <label htmlFor={id} className={labelClass}>{name}</label>;
  const provide = (control: ReactNode) => (
    <FieldContext.Provider value={{ id, invalid }}>
      {control}
    </FieldContext.Provider>
  );
  return <>{children({ label, provide })}</>;
}

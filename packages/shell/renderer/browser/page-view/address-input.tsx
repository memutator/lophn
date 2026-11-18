// 주소 한 줄. 글머리 label 없이 한 줄에 놓으므로 Field 대신 context만 주고 이름은 aria-label이 맡는다.
// Enter로 낸다. http·https 말고 scheme이 없는 주소는 https로 읽는다(그 기계가 http·https만 받는다).
import { useId } from "react";
import { FieldContext, Input } from "@lophn/ui/input";

export function withScheme(input: string): string {
  const trimmed = input.trim();
  return trimmed === "" || /^[a-z][a-z0-9+.-]*:/i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
}

export function AddressInput(props: {
  value: string;
  label: string;
  placeholder?: string;
  onChange(value: string): void;
  onSubmit(): void;
  onBlur?(): void;
}) {
  const id = useId();
  return (
    <FieldContext.Provider value={{ id, invalid: false }}>
      <Input
        size="sm"
        type="text"
        inputMode="url"
        spellCheck={false}
        autoComplete="off"
        aria-label={props.label}
        {...(props.placeholder === undefined
          ? {}
          : { placeholder: props.placeholder })}
        value={props.value}
        onChange={(event) => props.onChange(event.currentTarget.value)}
        onBlur={props.onBlur}
        onKeyDown={(event) => {
          if (event.key === "Enter") props.onSubmit();
        }}
      />
    </FieldContext.Provider>
  );
}

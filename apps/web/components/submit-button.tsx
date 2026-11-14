"use client";

import type { ComponentProps } from "react";
import { useFormStatus } from "react-dom";

export function SubmitButton({
  children,
  pendingLabel = "Saving…",
  disabled,
  ...props
}: Omit<ComponentProps<"button">, "type"> & { pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return (
    <>
      <button {...props} type="submit" disabled={pending || disabled} aria-busy={pending}>
        {pending ? pendingLabel : children}
      </button>
      <span className="screen-reader" role="status">
        {pending ? pendingLabel : ""}
      </span>
    </>
  );
}

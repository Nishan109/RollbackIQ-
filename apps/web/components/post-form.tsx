"use client";

import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";

export function PostForm({
  action,
  className,
  children,
  label,
  pendingLabel = "Saving…",
  variant = "secondary",
  disabled = false,
}: {
  action: string;
  className?: string;
  children: ReactNode;
  label: string;
  pendingLabel?: string;
  variant?: "primary" | "secondary";
  disabled?: boolean;
}) {
  const submitted = useRef(false);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    function onPageShow() {
      submitted.current = false;
      setPending(false);
    }
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);
  function submit(event: FormEvent<HTMLFormElement>) {
    if (submitted.current) {
      event.preventDefault();
      return;
    }
    submitted.current = true;
    setPending(true);
  }
  return (
    <form action={action} method="post" className={className} onSubmit={submit}>
      {children}
      <button
        type="submit"
        disabled={disabled || pending}
        aria-busy={pending}
        className={`button ${variant} compact`}
      >
        {pending ? pendingLabel : label}
      </button>
      <span className="screen-reader" role="status">
        {pending ? pendingLabel : ""}
      </span>
    </form>
  );
}

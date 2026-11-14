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
  newTab = false,
}: {
  action: string;
  className?: string;
  children: ReactNode;
  label: string;
  pendingLabel?: string;
  variant?: "primary" | "secondary";
  disabled?: boolean;
  newTab?: boolean;
}) {
  const submitted = useRef(false);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    function onPageShow() {
      submitted.current = false;
      setPending(false);
    }
    window.addEventListener("pageshow", onPageShow);
    if (newTab) window.addEventListener("focus", onPageShow);
    return () => {
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("focus", onPageShow);
    };
  }, [newTab]);
  function submit(event: FormEvent<HTMLFormElement>) {
    if (submitted.current) {
      event.preventDefault();
      return;
    }
    submitted.current = true;
    setPending(true);
  }
  return (
    <form
      action={action}
      method="post"
      className={className}
      onSubmit={submit}
      target={newTab ? "_blank" : undefined}
      rel={newTab ? "noopener" : undefined}
    >
      {children}
      <button
        type="submit"
        disabled={disabled || pending}
        aria-busy={pending}
        className={`button ${variant} compact`}
      >
        {pending ? pendingLabel : label}
        {newTab && <span className="screen-reader"> (opens in a new tab)</span>}
      </button>
      <span className="screen-reader" role="status">
        {pending ? pendingLabel : ""}
      </span>
    </form>
  );
}

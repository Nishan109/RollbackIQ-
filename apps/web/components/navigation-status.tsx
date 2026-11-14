"use client";

import { useLinkStatus } from "next/link";

export function NavigationStatus() {
  const { pending } = useLinkStatus();
  return (
    <span className="screen-reader" role="status">
      {pending ? "Loading page…" : ""}
    </span>
  );
}

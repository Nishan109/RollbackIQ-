"use client";

import { useLinkStatus } from "next/link";

export function NavigationStatus() {
  const { pending } = useLinkStatus();
  return (
    <span className="navigation-status" role="status">
      {pending && <span className="navigation-spinner" aria-hidden="true" />}
      <span className="screen-reader">{pending ? "Loading page…" : ""}</span>
    </span>
  );
}

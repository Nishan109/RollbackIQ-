"use client";
import { useState } from "react";
export function ConnectButton({
  organization,
  installation,
  label,
}: {
  organization: string;
  installation?: number;
  label?: string;
}) {
  const [connecting, setConnecting] = useState(false);
  const buttonLabel = label ?? (installation ? "Refresh access" : "Connect GitHub");
  return (
    <form action="/api/github/connect" method="post" onSubmit={() => setConnecting(true)}>
      <input type="hidden" name="organization" value={organization} />
      {installation && <input type="hidden" name="installation" value={installation} />}
      <button type="submit" disabled={connecting} className="button primary compact">
        {connecting ? "Connecting…" : buttonLabel}
      </button>
    </form>
  );
}

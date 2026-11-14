"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function ConnectionRefresh({
  organization,
  notify,
}: {
  organization: string;
  notify?: "authorized" | "connected" | "disconnected" | "saved";
}) {
  const router = useRouter();
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(`rollbackiq:github:${organization}`);
    channel.onmessage = ({ data }) => {
      if (data === "connection-updated") router.refresh();
    };
    if (notify) channel.postMessage("connection-updated");
    return () => channel.close();
  }, [organization, notify, router]);
  return null;
}

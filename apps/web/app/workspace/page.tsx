import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { idSchema, workspaceScans } from "@/lib/supabase/scans";
import { supabaseIdentity } from "@/lib/supabase/server";
import { Workspace } from "./workspace";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Workspace" };

export default async function WorkspacePage({
  searchParams,
}: {
  searchParams: Promise<{ scan?: string }>;
}) {
  const { scan } = await searchParams;
  const selected = scan === undefined ? undefined : idSchema.safeParse(scan);
  if (selected && !selected.success) notFound();
  const identity = await supabaseIdentity();
  if (!identity) {
    if (selected) redirect("/auth");
    return <Workspace />;
  }
  const selectedId = selected?.success ? selected.data : undefined;
  const saved = await workspaceScans(identity.client, selectedId);
  if (selectedId && !saved.unavailable && !saved.scans.some(({ id }) => id === selectedId))
    notFound();
  return <Workspace key={identity.user.id} saved={{ ...saved, selectedId }} />;
}

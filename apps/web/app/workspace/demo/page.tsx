import type { Metadata } from "next";
import { getCompatibilityDemo } from "@/lib/compatibility-demo";
import { getDemo } from "@/lib/demo";
import { Workspace } from "../workspace";

export const metadata: Metadata = { title: "Demo workspace" };

export default async function DemoWorkspacePage() {
  const [{ samples, report }, compatibility] = await Promise.all([
    getDemo(),
    getCompatibilityDemo(),
  ]);
  return <Workspace demo={{ samples, report, compatibility }} />;
}

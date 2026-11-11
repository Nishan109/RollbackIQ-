import type { Metadata } from "next";
import { Workspace } from "./workspace";

export const metadata: Metadata = { title: "Local workspace" };

export default function WorkspacePage() {
  return <Workspace />;
}

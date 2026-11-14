import { ArrowUpRight, CircleHelp, LayoutDashboard, UsersRound } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Brand } from "./brand";
import { NavigationStatus } from "./navigation-status";

export function ProductHeader({
  active,
  teamHref = "/team",
  guideHref = "/help",
  actions,
}: {
  active: "auth" | "team" | "repository" | "github";
  teamHref?: string;
  guideHref?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="product-header">
      <Brand />
      <nav className="product-header-nav" aria-label="Product navigation">
        {active === "auth" ? (
          <Link href="/workspace/demo">
            Explore the demo <ArrowUpRight size={14} aria-hidden="true" />
            <NavigationStatus />
          </Link>
        ) : (
          <>
            <Link href={teamHref} aria-current={active === "team" ? "page" : undefined}>
              <UsersRound size={15} aria-hidden="true" /> Team workspace
              <NavigationStatus />
            </Link>
            <Link href="/workspace">
              <LayoutDashboard size={15} aria-hidden="true" /> Dashboard
              <NavigationStatus />
            </Link>
          </>
        )}
        <Link href={guideHref} className="product-help">
          <CircleHelp size={16} aria-hidden="true" /> Help
          <NavigationStatus />
        </Link>
        {actions}
      </nav>
    </header>
  );
}

import "@fontsource-variable/geist";
import "@fontsource-variable/jetbrains-mono";
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL || "https://rollback-iq.vercel.app"),
  title: {
    default: "RollbackIQ · PostgreSQL migration compatibility",
    template: "%s · RollbackIQ",
  },
  description:
    "Compare PostgreSQL migrations with previous-release queries and review compatibility findings before you deploy.",
  openGraph: {
    title: "RollbackIQ · PostgreSQL migration compatibility",
    description: "Review migration findings, evidence and coverage before you merge.",
    siteName: "RollbackIQ",
    type: "website",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

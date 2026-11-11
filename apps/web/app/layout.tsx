import "@fontsource-variable/geist";
import "@fontsource-variable/jetbrains-mono";
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "RollbackIQ · Know Your Rollback Risk", template: "%s · RollbackIQ" },
  description:
    "Detect database migration hazards and application compatibility risks before your next release.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

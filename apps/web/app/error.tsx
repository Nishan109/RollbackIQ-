"use client";

import { RefreshCw } from "lucide-react";
import { Brand } from "@/components/brand";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="container section">
      <Brand />
      <h2>We couldn’t load this page.</h2>
      <button type="button" className="button primary" onClick={reset}>
        <RefreshCw size={16} /> Try again
      </button>
    </main>
  );
}

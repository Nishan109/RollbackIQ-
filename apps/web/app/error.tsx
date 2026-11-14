"use client";

import { RefreshCw } from "lucide-react";
import Link from "next/link";
import { Brand } from "@/components/brand";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="container section">
      <Brand />
      <h1>We couldn’t load this page.</h1>
      <p role="alert">Check your connection and try loading the page again.</p>
      <button type="button" className="button primary" onClick={reset}>
        <RefreshCw size={16} /> Try again
      </button>
      <Link className="text-link" href="/help">
        Help center
      </Link>
    </main>
  );
}

import { GitMerge } from "lucide-react";
import Link from "next/link";

export function Brand() {
  return (
    <Link href="/" className="brand" aria-label="RollbackIQ home">
      <span className="brand-icon">
        <GitMerge size={20} strokeWidth={2.6} />
      </span>
      <span>
        Rollback<span className="brand-iq">IQ</span>
      </span>
    </Link>
  );
}

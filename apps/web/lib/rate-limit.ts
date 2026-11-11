export function requestLimit({
  perIdentity,
  total,
  concurrent,
}: {
  perIdentity: number;
  total: number;
  concurrent: number;
}) {
  let windowStart = 0;
  let count = 0;
  let active = 0;
  const identities = new Map<string, number>();
  return (identity: string) => {
    const now = Date.now();
    if (now - windowStart >= 60_000) {
      windowStart = now;
      count = 0;
      identities.clear();
    }
    const seen = identities.get(identity) ?? 0;
    if (count >= total || seen >= perIdentity || active >= concurrent) return null;
    count += 1;
    active += 1;
    identities.set(identity, seen + 1);
    return () => {
      active -= 1;
    };
  };
}

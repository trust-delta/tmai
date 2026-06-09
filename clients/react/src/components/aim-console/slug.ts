// Client-side slug helpers for the aim-console create-aim modal — a fast-feedback
// MIRROR of the backend's `validate_new_aim_slug` (tmai-core #501) and the
// destination mock's `validateSlug` / `suggestSlug`. The backend stays
// authoritative (it owns the `409` / `422`); these only spare the operator a
// round-trip on the obvious cases. Pure + framework-free so they unit-test in
// isolation.

// Validate a candidate slug shape. Returns a short Japanese message (the
// console UI is `lang=ja`, mirroring the mock's copy), or `null` when the shape
// is valid. An EMPTY slug is "not yet" — not a shape error — so it returns
// `null`; the caller gates the submit on non-emptiness. Duplicate detection is
// the caller's job (it owns the repo's existing-slug set).
export function validateAimSlug(slug: string): string | null {
  if (slug === "") return null;
  // lowercase kebab only — alnum runs joined by single `-`, no leading /
  // trailing / doubled `-`.
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) return "lowercase kebab のみ（[a-z0-9-]）";
  // A `YYYY-MM-DD-` prefix is the decision / approach convention; aim slugs are
  // dateless stable identities.
  if (/^\d{4}-\d{2}-\d{2}/.test(slug)) return "日付 prefix 不可";
  return null;
}

// Max slug length (mirrors the mock's 40-char cap).
const SLUG_MAX = 40;

// Strip any trailing `-` — a 40-char cut can land mid-separator, and a trailing
// hyphen fails `validateAimSlug`.
const trimTrailingDash = (s: string): string => s.replace(/-+$/, "");

// Derive a kebab slug suggestion from the aim text, de-duplicated against the
// repo's existing slugs (append `-2`, `-3`, …). Mirrors the mock's
// `suggestSlug`: lowercase, alnum runs joined by `-`, falling back to `new-aim`
// when the aim has no usable characters. ALWAYS returns a value that passes
// `validateAimSlug`: the 40-char cap is enforced WITH no trailing hyphen, and
// the dedup suffix shrinks the base so the whole slug stays ≤ 40.
export function suggestSlug(aim: string, existing: ReadonlySet<string>): string {
  const base =
    trimTrailingDash((aim.toLowerCase().match(/[a-z0-9]+/g) ?? []).join("-").slice(0, SLUG_MAX)) ||
    "new-aim";
  if (!existing.has(base)) return base;
  // Collision — append `-N`, trimming the base so base+suffix stays within cap
  // and never ends on a dangling hyphen.
  for (let i = 2; ; i++) {
    const suffix = `-${i}`;
    const candidate = trimTrailingDash(base.slice(0, SLUG_MAX - suffix.length)) + suffix;
    if (!existing.has(candidate)) return candidate;
  }
}

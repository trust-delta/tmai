---
status: accepted
category: foundational
governs:
  - clients/react/
  - clients/ratatui/
  - api-spec/
cross-repo-refs:
  - "tmai-core:doc/decisions/2026-05-18-design-authority-locus-and-public-charter.md"
  - "tmai-core:doc/decisions/2026-05-13-tmai-is-a-producer-exoskeleton.md"
  - "tmai-core:doc/decisions/2026-05-15-protect-scarce-human-judgment.md"
last-verified: 2026-05-31
contract-surface: false
related:
  - "2026-05-14-webui-simulated-onboarded-posture"
  - "2026-05-14-react-producer-console-rebuild"
---

# Public tmai charter — what this repo is for, and what its UI optimizes

**Date:** 2026-05-18
**Status:** Accepted — the public, pitch-altitude purpose anchor for this
repo. `category: foundational` because it is this repo's reason to exist;
retracting it would orphan every UI/contract decision here. Governed by a
design-authority decision held in the private `tmai-core` repo (referenced
by path under `cross-repo-refs:`; its content is private by deliberate
design — see "Authority stance" below). Ratified by this DR's merge.

**2026-05-27 amend:** adds § "What tmai imposes — and why" — the opinionated discipline
tmai places on an adopting project, stated at pitch altitude (disclosed purpose, not core's
*how*; in-bounds per the paired design-authority decision's §B converse — already-disclosed
purpose carries no leak). Producer-drafted; the `accept` is the operator's merge. The
README's user-facing derivation of this section is a paired follow-on.

(No `tier:` field — authority is derived from the act, not a stored tag;
`category: foundational` is the residue. The two 2026-05-14 records here
predate that and still carry `tier:`; migrating them is out of scope.)

## What tmai is

**tmai is a Producer's exoskeleton and a human console.** It exists to
make the operator invest their scarce review-attention into the
highest-value judgments — not to maximize agent throughput. The operator
talks to one Producer agent; tmai is the layer that lets that Producer
manage work and that surfaces, to the human, exactly what deserves
attention.

## What tmai imposes — and why (the opinionated part)

tmai is **opinionated**, and the opinion is load-bearing, not cosmetic. Adopting tmai on a
project means adopting a discipline it will not let you quietly skip:

- **Purpose and means are kept apart.** What you commit to — an outcome or value you bear, a
  *decision* — is recorded separately from how you currently pursue it — the mechanism, an
  *approach*, which stays mutable and re-openable. A means is never smuggled into a
  commitment.
- **Only you accept a decision.** The Producer drafts, proposes, and runs the means; it
  never *accepts* a decision on your behalf. The irreducibly-human act stays human by
  construction — there is no "the agent decided for me."
- **Your review attention is rationed, not optimized away.** tmai routes only the decisions
  that genuinely need you, and will not pretend a glance-and-approve is a real review.

**Why impose this instead of just going fast?** Because the scarce resource is your
judgment, not agent compute. A tool that makes the *wrong* workflow effortless — approve
everything, fan out endlessly, let the agent bless its own work — spends that scarce
resource exactly where it should be protected. The discipline above is the minimum that
keeps the human bearing the commitments while the agent carries the mechanism. (The fuller
reasoning drives the engine's design and stays with it — private under the same
motivation-protection stance stated below; what is stated here is the part you, as an
operator, are signing up for.)

**This is a worldview, offered — not a universal truth.** If what you want is to maximize
how much the agent does unattended, tmai is deliberately the wrong tool: it keeps a seam
where *you* stay in the loop, because that seam is where it believes the value lives. That
is a self-selecting stance — stated up front so you can decide before adopting it, rather
than discover it by friction.

## What this (public) repo is for

This repo holds the **presentation and contract half** of that goal:
`clients/react/` (the Producer console WebUI), `clients/ratatui/` (the
TUI), `api-spec/` (the wire contract), and the release pipeline. The
attention-investment goal is realized along a pipeline: the engine
produces and curates the information; **this repo decides what subset of
it the operator sees, when, and in what framing, cadence, and salience.**

That presentation judgment is not incidental. Showing everything the
engine can produce is the *opposite* of protecting attention. *What /
when / how surfaced* is a large part of whether scarce attention is
actually protected — so this repo is a first-class part of the goal, not
a thin renderer.

## The UI side's responsibility

Build presentation that is **faithfully derived from an understanding of
tmai's principles** — comprehension first, then realization. UI work here
should be traceable to *why* (the purpose above and the principles it
serves), not invented locally.

## Authority stance (why this repo is intentionally record-light)

The **design authority** for tmai's mechanisms — the *how* — is held in
the private `tmai-core` repo, by deliberate design. This is the same,
already-public reason `tmai-core` itself is private: it protects the
author's motivation (concealed implementation insight), not commercial
IP. A consequence, by design and not by neglect:

- This repo **does not** carry "design-driver" records (records of the
  form *"we need the engine to do X"*). Those would leak the private
  *how* through the public *what-was-asked*, so they stay private.
- This repo's records are therefore exactly: **this charter** (purpose),
  plus thin **UX-posture** decisions about what the operator
  *experiences* (e.g. the existing simulated-onboarded posture and
  console-rebuild records). Both are public-appropriate — they are the
  *what*, never the engine's *how*.

So the asymmetry (most decision records live in `tmai-core`) is **by
design**. What this charter guarantees is that the public repo's *goal is
visible here* — it does not "exist only in an invisible part."

## What this is / is not

- **Is**: the comprehension anchor UI/contract work derives from; the
  public statement of this repo's purpose.
- **Is not**: a place to record "the engine should do X" (private by
  design); not an implementation spec. The mechanism by which private
  design intent reaches UI work is a separate, co-designed record (it
  does not live here).

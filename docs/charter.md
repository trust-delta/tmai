# The tmai charter — what this repo is for, and what its UI optimizes

This is the standing, public-facing statement of tmai's purpose: the anchor that UI and contract work in this repo derives from. It is not a record of a decision taken on a date — the retired record that first ratified this charter is kept as history in [`docs/archive/decisions/`](archive/decisions/2026-05-18-public-tmai-charter.md).

## What tmai is

**tmai is a Producer's exoskeleton and a human console.** It exists to make the operator invest their scarce review-attention into the highest-value judgments — not to maximize agent throughput. The operator talks to one Producer agent; tmai is the layer that lets that Producer manage work, and that surfaces, to the human, exactly what deserves attention.

## What tmai imposes — and why (the opinionated part)

tmai is **opinionated**, and the opinion is load-bearing, not cosmetic. Adopting tmai on a project means adopting a discipline it will not let you quietly skip:

- **Purpose and means are kept apart.** Where a piece of work is *going* — the outcome you commit to, the thing you'll bear if it's wrong — is written by you, and kept distinct from *how it is currently being pursued*, which the Producer maintains and may rewrite at any time. A means never quietly becomes the commitment. The apparatus that currently holds both is [Aim](aim.md) — a means itself, and replaceable.
- **Only you declare arrival.** The Producer drafts the means, runs it, and reports what it has implemented — a claim, checkable and fallible. It never declares that the *purpose* has been met. The irreducibly-human act stays human by construction, not by policy: there is no "the agent decided for me."
- **Your review attention is rationed, not optimized away.** tmai routes only the judgments that genuinely need you, and will not pretend a glance-and-approve is a real review.

**Why impose this instead of just going fast?** Because the scarce resource is your judgment, not agent compute. A tool that makes the *wrong* workflow effortless — approve everything, fan out endlessly, let the agent bless its own work — spends that scarce resource exactly where it should be protected. The discipline above is the minimum that keeps the human bearing the commitments while the agent carries the mechanism. (The fuller reasoning drives the engine's design and stays with it — private under the same motivation-protection stance stated below; what is stated here is the part you, as an operator, are signing up for.)

**This is a worldview, offered — not a universal truth.** If what you want is to maximize how much the agent does unattended, tmai is deliberately the wrong tool: it keeps a seam where *you* stay in the loop, because that seam is where it believes the value lives. That is a self-selecting stance — stated up front so you can decide before adopting it, rather than discover it by friction.

## What this (public) repo is for

This repo holds the **presentation and contract half** of that goal: `clients/react/` (the Producer console WebUI), `clients/ratatui/` (the TUI), `api-spec/` (the wire contract), and the release pipeline. The attention-investment goal is realized along a pipeline: the engine produces and curates the information; **this repo decides what subset of it the operator sees, when, and in what framing, cadence, and salience.**

That presentation judgment is not incidental. Showing everything the engine can produce is the *opposite* of protecting attention. *What / when / how surfaced* is a large part of whether scarce attention is actually protected — so this repo is a first-class part of the goal, not a thin renderer.

## The UI side's responsibility

Build presentation that is **faithfully derived from an understanding of tmai's principles** — comprehension first, then realization. UI work here should be traceable to *why* (the purpose above and the principles it serves), not invented locally.

## Authority stance (why this repo is intentionally record-light)

The **design authority** for tmai's mechanisms — the *how* — is held in the private [`tmai-core`](https://github.com/trust-delta/tmai-core) repo, by deliberate design. This is the same, already-public reason `tmai-core` itself is private: it protects the author's motivation (concealed implementation insight), not commercial IP. A consequence, by design and not by neglect:

- This repo **does not** carry "design-driver" records (records of the form *"we need the engine to do X"*). Those would leak the private *how* through the public *what-was-asked*, so they stay private.
- What this repo carries is therefore thin: **this charter** (the purpose) and **[Aim](aim.md)** (the means that purpose currently reaches for). Both are public-appropriate — they are the *what*, never the engine's *how*. Everything under [`docs/archive/`](archive/) is a retired audit trail, not current direction.

So the asymmetry (design records live in `tmai-core`) is **by design**. What this charter guarantees is that the public repo's *goal is visible here* — it does not "exist only in an invisible part."

## What this is / is not

- **Is**: the comprehension anchor UI/contract work derives from; the public statement of this repo's purpose.
- **Is not**: a place to record "the engine should do X" (private by design); not an implementation spec. The mechanism by which private design intent reaches UI work is a separate, co-designed record (it does not live here).

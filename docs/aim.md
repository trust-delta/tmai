# Aim — the destination, and knowing you've arrived

tmai's console asks you to do two things a tool can't do for you: say where a piece of work is *going*, and say when it has *got there*. **Aim** is how tmai currently records both. The order matters: Aim did not come first, and tmai was not built around it. The principles came first; Aim is the means they currently reach for — kept because it works, and replaceable the day a better means shows up.

This mirrors the crossing-the-street picture in the [README](../README.md): you set the destination, the agent drives, and the one call the traffic light can never make for you is *"you've arrived."* Aim is where that destination is written down and where that arrival is declared.

## The principle Aim serves

tmai is built on one wager: the scarce resource is your judgment, not agent compute (see the [charter](charter.md)). Two acts in that judgment are irreducibly yours — no stronger model removes them:

- **naming the destination** — the outcome you're committing to, the thing you'll bear if it's wrong;
- **declaring arrival** — deciding the work actually got there, backed by real verification and not by a glance or a green check.

A tool that honours that wager needs somewhere to put both — somewhere that keeps the destination a *human commitment* rather than a checklist, and keeps arrival a *human act* rather than an automated pass. It should make that declaration **locatable** (one place, one owner), **obligatory** (you can't ship without it), and **traceable** (a record of what was verified) — while never *making the call for you*. Aim is that somewhere.

## Aim is a means, not a premise

The clearest evidence that Aim is derived and not axiomatic is that tmai reached this shape by replacing an earlier one. The first apparatus was a pair of records: a **decision** (the outcome you bear) kept deliberately apart from an **approach** (how you're currently chasing it, mutable). You can still read those retired records in [`docs/archive/`](archive/) — kept as an audit trail, not current direction. Aim is their successor: it folds "the destination" and "how it's being pursued" into one evolving record, and it scales to trees of nested purpose better than the two-slot form did.

What did *not* change across that swap is the principle above. The destination stayed a human commitment; arrival stayed a human act. That is the whole point of calling Aim a *means*: the philosophy is the fixed part, and the apparatus is free to move under it. If something represents "destination + arrival" better tomorrow, Aim gets replaced too, and nothing load-bearing moves.

## What an aim is

An aim is a small record with three parts, and the split is not cosmetic — it *is* the order of authority:

- **the destination** — a one-sentence statement of what this work is *for*, written by you. It's phrased as what *ought* to be true, not as "if X is built, we're done." (The moment a destination is written as a sufficient mechanism, it has quietly become a spec, and the human commitment has drained out of it.)
- **the means** — a body the Producer maintains: how the work is currently being pursued, what's done, what's left. This is the agent's to draft and revise. Marks in it record what the Producer *has implemented* — a claim, checkable and fallible — and never that the *purpose* has been met.
- **the state** — open or done, which only you flip, and only after you've verified arrival.

So authority runs **destination (yours) → means (the Producer's) → code**. The means can be rewritten freely; the code is just the current situation and can drift. Neither gets to certify that an aim's purpose is met. Only your flip of the state does that.

## The line Aim does not cross

Aim makes a done-declaration locatable, obligatory, and traceable. It does not make it *genuine* — and it deliberately stops one step short of trying. Whether the purpose was actually realized is not formalized into conditions the system can check, because doing that would change what the thing *is*: a borne judgment turned into a checklist is no longer the judgment, and optimizing to the checklist quietly deletes what it stood for. This is the same seam as the traffic light in the README — the structure can show you the crossing you must look at; it can never tell you *"you've arrived."* That call is kept yours by construction, not by policy.

## What the engine derives from it — and why the how is private

Because aims are structured, the engine can compute over them — and that is what turns the structure into what you actually feel in the console. From the gap between a stated aim and the code that claims to serve it, the private engine surfaces **drift** (where the work and its stated purpose have pulled apart), helps **reconcile** the record back to reality, and distils the **changes worth your attention** — so you're brought the one crossing to look at instead of all of them. That these capabilities exist, and that they're powered by the Aim structure, is public: it's what the console is *for*. *How* they're computed stays in the private [`tmai-core`](https://github.com/trust-delta/tmai-core) engine, under the same stance the charter states — the concealment protects the author's motivation, not commercial IP. The public half is the *what* (a destination, an arrival, and a tool that points your attention at the gap); the engine's *how* is the private half.

## Why this isn't spec-driven development

Aim and a spec share a shape — both write down an intent and check work against it — so it's worth naming the difference, which is where the authority for "done" sits. Spec-driven development seats it in acceptance criteria a machine can check: the agent marks the criteria met, and when a human says "that's not actually done," the fix is *more criteria*. Its horizon is the point where the spec is complete enough that agent-done equals real-done — which is to say, the point where human satisfaction has been engineered out. Aim starts from the opposite premise and never gives it up: **whether the purpose is met is something only a human can judge.** Your "that's not it" isn't a gap in the criteria to be patched away; it's the whole point — the place the design *puts* the verdict, not a place it's trying to eliminate.

---

See also: the [public charter](charter.md) (this repo's purpose anchor) and the "What tmai is for" section of the [README](../README.md).

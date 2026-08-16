# People as a first-class entity

`Person` is a child row hanging off a single company with no slug and no identity of its own.
A founder who started three companies is three unrelated rows that we can't connect, and
there's no `/people` route at all. This is a big chunk of the graph Crunchbase charges for and
we're throwing it away at write time.

Want `Person` promoted to a top-level table with a slug, deduplicated on name plus LinkedIn
URL (LinkedIn URL is the only reliable key we have — name alone will collide badly at our
scale), plus a `PersonRole` join carrying title, role, and a date range, pointing at **both**
companies and investor firms. The investor side matters: "partner at this firm, previously
founded X" is the connective tissue that makes the dataset feel like a network instead of a
directory.

Seed data is already flowing — the Form D `relatedPersonsList` extraction gives us executives
and directors keyed by CIK, and Wikidata gives founders and CEOs. The migration needs to
collapse existing `Person` rows into deduplicated people plus roles, which is the fiddly part;
same entity-resolution problem as the merge queue, so the two tickets should probably share
whatever matching machinery we build.

Unlocks `/people/[slug]` profiles, serial-founder discovery, "who else has this person backed",
and board-seat views. Also gives contributors something much more interesting to fill in than
another funding round.

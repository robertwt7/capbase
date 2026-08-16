# Structured geography

`Company.hq` is a free-text string ("San Francisco, CA", "London", whatever the source gave
us). We can't filter by country, can't build per-country or per-city league tables, can't put
anything on a map, and can't answer "show me German fintech" — which is one of the most
obvious things someone would want from us.

Want `hq` split into city, region/state, ISO 3166-1 country code, and lat/lng, keeping the
original string around as the display value so nothing regresses. Backfill from what we've
already got: SEC gives us clean city/state pairs (`sec-edgar.source.ts` joins them into the
string in the first place, so that one's trivially reversible), ADV has city/state/country
columns, and Wikidata has proper location entities. There's already a `lib/cities.ts` in the
web app worth looking at before writing a new gazetteer.

Then: country and city filters on both directories, `/geo/[country]` and
`/geo/[country]/[sector]` pages, and a map somewhere on the landing page or the markets pages.
The route pages are a lot of indexable surface generated from data we already hold, which
matters given how much of our traffic is search.

Cheapest of the outstanding data-model changes and it should land **before** we ingest any
non-US source, alongside adding a currency column — otherwise we do the migration twice and
the second time it's over a much bigger table. Same argument as the currency gap: both are
things that get baked in wrong if we start ingesting UK/EU data first.

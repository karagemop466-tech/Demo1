# Supplemental live Kalshi demo desk

This standalone, read-only monitor is published at `/live-desk/` alongside the repository's existing root GitHub Pages site. Its public market reads are directed only at the recommended Kalshi demo REST API.

- [Open the supplemental dashboard](index.html)
- [Topic directory](pages/topics.html) and category subpages for gas, elections, culture, crypto, golf
- [Executive summary](pages/summary.html)
- [Requirements and decision questions](pages/requirements.html)
- [Flagged for review](pages/flagged.html)
- [Methodology and sources](pages/methodology.html)

This subsite does not ask for or store API keys and does not execute trades. Portfolio integration and authenticated stream data require a separately authorized, secure backend; browser CORS and source availability must be checked at runtime. See the flagged page before relying on coverage or calculated book depth.

Local checks from the repository root:

```sh
python3 live-desk/scripts/build_site.py
python3 live-desk/scripts/check_site.py --root live-desk/.site-dist
node --check live-desk/app.js
```

Official sources are linked in the source register and beside each data/requirement row. See the repository-level `COORDINATION.md` for the overlap resolution and deployment record.

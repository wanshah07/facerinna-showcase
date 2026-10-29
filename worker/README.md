# facerinna-visitors

The page-view counter behind the **Visitors** tab of `admin.html`. A Cloudflare
Worker with one D1 table. The public pages send one `POST /hit` per page load
(`fx-visit.js`), the Worker reads country, state and city off the connection,
and the booth Apps Script reads `/stats` and `/export.csv` with a key.

No cookie, no browser storage, no IP stored. One phone is one visitor per
Malaysian calendar day through a salted hash that cannot be reversed.

## First deploy

    cd worker
    npx wrangler login                              # or CLOUDFLARE_API_TOKEN
    npx wrangler d1 create facerinna-visitors       # paste the id into wrangler.toml
    npx wrangler d1 execute facerinna-visitors --remote --file schema.sql
    npx wrangler secret put STATS_KEY               # long random string
    npx wrangler secret put SALT                    # another long random string
    npx wrangler deploy                             # prints the workers.dev address

Then:

1. `fx-visit.js`: put the workers.dev address into `COLLECTOR`.
2. Booth Apps Script, Project Settings, Script Properties:
   `VISITORS_URL` = the same address, `VISITORS_KEY` = the STATS_KEY value.
   Paste the current `tools/booth-admin.gs` in and deploy a new version.
3. Open admin.html, tick **Visitors** for whoever should see it under People.

## Local run

    printf 'STATS_KEY=test\nSALT=local\n' > .dev.vars
    npx wrangler d1 execute facerinna-visitors --local --file schema.sql
    npx wrangler dev --local

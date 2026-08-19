# Page objects

A journey says *what a user did*; a page object says *where the buttons are*.
When a screen's markup changes, exactly one file under this directory changes
with it — never a journey.

## The convention

- One file per screen: `project-list.page.ts`, exporting `class ProjectListPage`.
- The constructor takes the Playwright `Page`. Everything else is a method that
  either performs a user action (`await page.openProject('E2E Project')`) or
  returns a `Locator` for the journey to assert on.
- Selectors are `data-testid` attributes and nothing else. A CSS class is a
  styling decision and will change under you; a test id is a contract with the
  component, and the test contract of each increment names the ids it adds.
- No assertions inside a page object. A page object that asserts is a journey
  nobody can read.
- No `checkpoint()` inside a page object either — checkpoints are named moments
  in the *journey*, and the harness reads the journey's id to route the baseline.

There are no page objects yet: J-000 is a one-screen smoke on the scaffold home
page, and a page object for a single `h1` would be indirection with nothing in
it. The first multi-screen journey adds the first one here.

## Running the lane locally

```bash
pnpm exec playwright install --with-deps chromium   # once per machine
pnpm e2e                                            # every journey but the breakers
pnpm e2e --journey J-000                            # one journey, by its id
pnpm e2e --update-baselines --reason "new nav bar"  # rewrite the committed PNGs
```

The lane builds the app once, drops and recreates the scratch database
`vextrus_e2e_scratch` on the 5544 cluster, seeds it from `fixtures/e2e/seed/`,
starts `next start` on 3211 plus the no-op worker, and runs the journeys.
Baselines are compared on Linux only — on macOS or Windows the run prints
`baselines: skipped (non-linux)` and the rest of the checkpoint still holds.

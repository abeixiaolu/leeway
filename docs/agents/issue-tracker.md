# Issue tracker: Local Markdown

Issues and specs for this repo live as Markdown files in `.scratch/`.

## Conventions

- One feature per directory: `.scratch/<feature-slug>/`
- The spec is `.scratch/<feature-slug>/spec.md`
- Implementation issues are separate files at `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01`
- Triage state is a `Status:` line near the top of each issue file; use the roles in `triage-labels.md`
- Append conversation history under `## Comments`

## Skill operations

When a skill says “publish to the issue tracker,” create the appropriate file under `.scratch/<feature-slug>/`. When it says “fetch the relevant ticket,” read the referenced file.

For wayfinding, keep `.scratch/<effort>/map.md` and one child file per ticket in `.scratch/<effort>/issues/`. Each child records `Type:`, `Status:`, and, when needed, `Blocked by:` near the top. Claim a ticket by setting `Status: claimed`; resolve it by adding `## Answer`, setting `Status: resolved`, and adding a short decision pointer to the map. The frontier is the first numbered open, unblocked, unclaimed ticket.

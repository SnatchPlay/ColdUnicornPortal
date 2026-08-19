# Fixtures — `bison-blacklist-add`

Synthetic only. Never derived from a production execution: this workflow's payloads carry real
contact email addresses, and its CS PDCA lookup carries a live Bison API key.

Workspace `900001` is the conventional synthetic workspace used across these fixtures; `999999` is
deliberately unmapped.

| File | Case |
|---|---|
| `valid-input.json` | happy path — both limbs blacklist, both ids written back |
| `duplicate-email.json` | the 422 that aborts 63% of real runs (defect 1) |
| `public-domain-excluded.json` | exclude-list guard stops the domain blacklist |
| `missing-config.json` | workspace absent from CS PDCA — `Bearer undefined` |

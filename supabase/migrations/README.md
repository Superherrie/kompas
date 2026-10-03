# Migrations — apply order matters

Later files redefine functions from earlier ones. A fresh install, and any re-run, must go in this order:

    001 002 003 004 005 006 008 009 010 011 012 014 016 013 007 015

- 013 and 015 both define `pf_find_payment` → 015 must be last of the two.
- 007 and 013 both define `pf_match_slip` → 007 (claimable-aware) must come after 013.
- 014 and 016 both define the 3-argument `pf_categorise` → 016 must come after 014; 001 only creates a stub when none exists.
- 008 owns the `pf_v_txns` view (006 and 001 must not be re-applied after it without re-applying 008).

`node scripts/apply-schema.mjs <file>` applies one file.

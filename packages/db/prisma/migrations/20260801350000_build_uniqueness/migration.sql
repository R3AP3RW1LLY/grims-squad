-- One JOURNAL build per member per ship — and any number of pasted plans.
--
-- ★ THE CONSTRAINT THIS REPLACES CONTRADICTED ITS OWN COMMENT ★
--
-- `ship_builds` carried a unique on (submitted_by_id, ship_id, from_journal), documented as "pasted
-- links are deliberately NOT unique — one member may keep several plans for one hull". It did not
-- do that. Including from_journal as a COLUMN makes the tuple unique for every value of it, so the
-- second plan a member saved for the same hull was rejected with a unique violation.
--
-- Found the first time the Shipyard's save button was pressed against a real database.
--
-- What was meant is a PARTIAL unique index: unique on (member, ship) only where the row came from a
-- journal. Prisma cannot express that, so it is hand-written here and recorded in
-- ssot/03-data/indexes.md, per ADR-020.

-- ★ DROPPED BY WHAT IT IS, NOT BY WHAT IT MIGHT BE CALLED ★
--
-- Prisma names a @@unique from the columns by default and from `name:` when one is given, and this
-- one had a `name:` — so it exists as `ship_builds_one_journal_per_ship`, not the column-derived
-- name. Guessing left the old three-column unique in place beside the new partial one, and the bug
-- survived a migration that reported success.
--
-- So: find every UNIQUE index on exactly (submitted_by_id, ship_id, from_journal) and drop it,
-- whatever it is called. Nothing else is allowed to be unique on that triple.
DO $$
DECLARE victim text;
BEGIN
  FOR victim IN
    SELECT i.relname
    FROM pg_index x
    JOIN pg_class i ON i.oid = x.indexrelid
    JOIN pg_class t ON t.oid = x.indrelid
    WHERE t.relname = 'ship_builds'
      AND x.indisunique
      AND x.indpred IS NULL
      AND (
        SELECT array_agg(a.attname::text ORDER BY a.attname)
        FROM unnest(x.indkey) AS k(attnum)
        JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
      ) = ARRAY['from_journal', 'ship_id', 'submitted_by_id']
  LOOP
    EXECUTE format('ALTER TABLE ship_builds DROP CONSTRAINT IF EXISTS %I', victim);
    EXECUTE format('DROP INDEX IF EXISTS %I', victim);
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ship_builds_one_journal_per_ship_idx
  ON ship_builds (submitted_by_id, ship_id)
  WHERE from_journal;

-- Lookups by member and ship are now served by a plain index, since the unique above only covers
-- journal rows and the importer looks up pasted ones too.
CREATE INDEX IF NOT EXISTS ship_builds_submitted_by_id_ship_id_idx
  ON ship_builds (submitted_by_id, ship_id);

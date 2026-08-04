-- Corrective, minutes after 20260804120000. Hand-written (ADR-020).
--
-- The forum's reputation system already owns a badge table — member_badges, with its earned-at
-- semantics and its sweep — and the leaderboard build added a second one before noticing. Two
-- badge tables is two display pipelines and a guaranteed drift; the leaderboard badges are simply
-- MORE ROWS in member_badges under namespaced keys ('bounties-*', 'colony-*', 'trade-*').
--
-- user_badges was created empty this same hour and nothing ever wrote to it. Dropping it loses
-- nothing but the mistake.
DROP TABLE "user_badges";

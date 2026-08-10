-- Matching Decision Service - write-cutover completion plan, Phase C.
--
-- A real, production-blocking bug found before it could ship: this service's own `swipes_id_seq`
-- had fallen behind the table's actual MAX(id) - 198 vs. 232 on the database this was found
-- against, with 110 real dual-written rows. Every prior write to this table came from the
-- monolith's own dual-write hook (dualWrite.upsertSwipe), which always INSERTs with an EXPLICIT
-- id (the monolith's own SERIAL-assigned value) - Postgres never consults a column's sequence
-- when an explicit value is supplied, so the sequence itself never advanced past whatever it was
-- seeded at, even as 110 real rows accumulated past it.
--
-- This service is about to become the real write-authority for `swipes` (Phase C) - its own
-- INSERT will rely on the sequence's default nextval() for the first time ever. Without this
-- fix, the very first real swipe recorded through the new code path would have collided with an
-- already-existing id and failed with a primary key violation. recruiter_notes/
-- detailed_scoring_reports are resynced too, defensively, ahead of Phase D's own write cutover -
-- neither had drifted as far (much lower write volume), but the same structural risk applies to
-- both for the identical reason.

BEGIN;

SELECT setval('swipes_id_seq', GREATEST((SELECT COALESCE(MAX(id), 0) FROM swipes), 1));
SELECT setval('recruiter_notes_id_seq', GREATEST((SELECT COALESCE(MAX(id), 0) FROM recruiter_notes), 1));
SELECT setval('detailed_scoring_reports_id_seq', GREATEST((SELECT COALESCE(MAX(id), 0) FROM detailed_scoring_reports), 1));

INSERT INTO schema_migrations (version) VALUES ('002_resync_sequences')
  ON CONFLICT (version) DO NOTHING;

COMMIT;

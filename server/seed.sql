-- Local development seed.
--
-- One FREE skill and one PAID one. The free row is deliberate: it makes
-- the whole store — sign in, catalogue, entitlement, licence, download,
-- install — runnable end to end without moving money, so the payment
-- path is the only thing that needs a real handset to test.
--
-- The free skill is the one that actually exists in this repo
-- (skills/beat-montage), so what is catalogued here is a real package.

DELETE FROM skill_versions WHERE skill_id IN ('beat-montage', 'cinematic-grade');
DELETE FROM skills WHERE id IN ('beat-montage', 'cinematic-grade');

INSERT INTO skills (id, name, summary, description, author_name, major_version,
                    latest_version, tool_api, price_amount, price_currency,
                    included, status, verified_at, verified_build, created_at, updated_at)
VALUES
  ('beat-montage', 'Beat Montage',
   'Cuts a folder of footage to the beat of its own music bed, 9:16.',
   'Point it at a folder. It imports, orders by filename, detects the tempo of the bundled bed and lands every cut on a real onset — then exports portrait. The template is a playable project on its own, so a fumbled run still leaves you something to edit.',
   'Kerf', 1, '1.0.0', 1,
   0, 'TZS', 1,
   'published', strftime('%s','now') * 1000, 'Kerf 1.2.0 · 12/12 checks',
   strftime('%s','now') * 1000, strftime('%s','now') * 1000),

  ('cinematic-grade', 'Cinematic Grade',
   'Teal-and-orange grade, scope bars and grain across every clip.',
   'A look, not a filter: the grade is applied per clip with the tone curves the compositor actually renders, letterbox bars sized to 2.39:1, and film grain that moves. Priced as a one-time purchase for version 1.x.',
   'Kerf', 1, '1.0.0', 1,
   5000, 'TZS', 0,
   'published', strftime('%s','now') * 1000, 'Kerf 1.2.0 · seeded for local dev',
   strftime('%s','now') * 1000, strftime('%s','now') * 1000);

INSERT INTO skill_versions (skill_id, version, r2_key, size_bytes, sha256, tool_api, manifest_json, released_at)
VALUES
  ('beat-montage', '1.0.0', 'skills/beat-montage/1.0.0.kerfskill', 0,
   'seed-placeholder-replaced-on-publish', 1, NULL, strftime('%s','now') * 1000),
  ('cinematic-grade', '1.0.0', 'skills/cinematic-grade/1.0.0.kerfskill', 0,
   'seed-placeholder-replaced-on-publish', 1, NULL, strftime('%s','now') * 1000);

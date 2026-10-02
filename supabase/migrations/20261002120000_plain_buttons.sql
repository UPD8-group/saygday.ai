-- Plain chat buttons (owner, 2 October 2026): eleven simple shapes beside the
-- chat bubble, for a business that wants something quieter than the mob. The
-- list is shared/characters.mjs (CHARACTER_KEYS); test/characters.test.mjs
-- checks this one matches it.
alter table public.businesses drop constraint businesses_character_check;
alter table public.businesses add constraint businesses_character_check check (character in (
  'bubble','typing','bubbles','gday','hi','question','plus','smile','heart','ring','dot','ring-dot',
  'skippy','quigley','eddie','kiki','kip','penny','sully','wally'
));

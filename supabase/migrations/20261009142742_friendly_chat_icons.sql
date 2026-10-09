-- Additional owner-selected chat icons. Existing settings and access stay unchanged.
alter table public.businesses drop constraint businesses_character_check;
alter table public.businesses add constraint businesses_character_check check (character in (
  'bubble','typing','bubbles','gday','hi','wave','question','plus','smile','heart','ring','dot','ring-dot','info','lifebuoy','skippy','quigley','eddie','kiki','kip','penny','sully','wally'
));

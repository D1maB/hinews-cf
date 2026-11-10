CREATE TABLE IF NOT EXISTS feeds (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL
);

INSERT OR IGNORE INTO feeds (id, name, url) VALUES
  ('tomshardware', 'Tom''s Hardware', 'https://www.tomshardware.com/feeds/all'),
  ('techpowerup', 'TechPowerUp', 'https://www.techpowerup.com/rss/news'),
  ('kitguru', 'KitGuru', 'https://www.kitguru.net/feed/'),
  ('wccftech', 'Wccftech', 'https://wccftech.com/feed/'),
  ('guru3d', 'Guru3D', 'https://www.guru3d.com/rss.xml'),
  ('pcgamer', 'PC Gamer', 'https://www.pcgamer.com/rss/'),
  ('hexus', 'HEXUS', 'http://www.hexus.net/rss/hexus_rss.xml'),
  ('overclock3d', 'Overclock3D', 'https://overclock3d.net/feed/');

-- Last known copy of the published WordPress posts, so a restart or a WordPress outage does not empty the app.
CREATE TABLE IF NOT EXISTS news_posts (
  id INTEGER PRIMARY KEY,
  data JSONB NOT NULL,
  published_at TIMESTAMP NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS news_post_sections (
  section VARCHAR(40) NOT NULL,
  post_id INTEGER NOT NULL REFERENCES news_posts(id) ON DELETE CASCADE,
  PRIMARY KEY (section, post_id)
);
CREATE INDEX IF NOT EXISTS news_post_sections_post ON news_post_sections(post_id);

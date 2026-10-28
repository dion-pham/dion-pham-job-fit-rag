CREATE EXTENSION IF NOT EXISTS vector;

-- One row per resume bullet. Each bullet is its own retrieval chunk.
CREATE TABLE IF NOT EXISTS resume_bullets (
  id         SERIAL PRIMARY KEY,
  role       TEXT NOT NULL,
  text       TEXT NOT NULL UNIQUE,
  embedding  vector(384) NOT NULL
);

-- One row per job posting (from Notion or a local file).
CREATE TABLE IF NOT EXISTS postings (
  id          TEXT PRIMARY KEY,
  company     TEXT NOT NULL,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  source      TEXT NOT NULL CHECK (source IN ('notion', 'file')),
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Requirements Claude extracted from a posting.
CREATE TABLE IF NOT EXISTS requirements (
  id          SERIAL PRIMARY KEY,
  posting_id  TEXT NOT NULL REFERENCES postings(id) ON DELETE CASCADE,
  text        TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('required', 'nice_to_have')),
  embedding   vector(384) NOT NULL
);

-- Top-k bullets retrieved for each requirement, saved so evals are reproducible.
CREATE TABLE IF NOT EXISTS matches (
  requirement_id INT  NOT NULL REFERENCES requirements(id) ON DELETE CASCADE,
  bullet_id      INT  NOT NULL REFERENCES resume_bullets(id) ON DELETE CASCADE,
  rank           INT  NOT NULL,
  similarity     REAL NOT NULL,
  PRIMARY KEY (requirement_id, bullet_id)
);

CREATE INDEX IF NOT EXISTS resume_bullets_embedding_idx
  ON resume_bullets USING hnsw (embedding vector_cosine_ops);

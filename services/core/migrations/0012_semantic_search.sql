-- Semantic search (Modules 10 and 11): sentence embeddings from ALT's ML service (BAAI/bge-small-en-v1.5,
-- 384 dimensions). Only vectors are stored, never the passages: their text stays encrypted with the dataset item.
-- Plain real[] arrays compared in ALT Core, which is fast enough at this scale; pgvector is the step for later.

-- One vector per passage of an AI's consented text items (passages as chunk() cuts them).
CREATE TABLE core.dataset_chunks (
  dataset_id    uuid        NOT NULL REFERENCES core.datasets(id) ON DELETE CASCADE,
  chunk_no      integer     NOT NULL,
  text_sha256   char(64)    NOT NULL,   -- the passage it was made from; a changed passage is embedded again
  model         text        NOT NULL,
  embedding     real[]      NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (dataset_id, chunk_no)
);

-- One vector per AI for "find an AI like..." on ALTAR (name, category, description and public persona).
CREATE TABLE core.ai_search_vectors (
  ai_id         uuid        PRIMARY KEY REFERENCES core.personal_ais(id) ON DELETE CASCADE,
  text_sha256   char(64)    NOT NULL,
  model         text        NOT NULL,
  embedding     real[]      NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

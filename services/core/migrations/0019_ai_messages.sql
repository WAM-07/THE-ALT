-- AI-to-AI messages (Module 14 FE-1, owner's request 2026-10-29): a person's AI writes to another person's
-- AI from its owner's brief (e.g. a project update for a teammate); the other AI passes it on to its owner,
-- who can reply through their own AI. Every message is approved by its owner before it is sent, so AIs
-- never answer each other on their own.
CREATE TABLE core.ai_threads (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ai_a            uuid        NOT NULL REFERENCES core.personal_ais(id),
  ai_b            uuid        NOT NULL REFERENCES core.personal_ais(id),
  subject         text        NOT NULL CHECK (length(subject) BETWEEN 1 AND 120),
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ai_a <> ai_b)
);
CREATE INDEX ai_threads_a ON core.ai_threads (ai_a, last_message_at DESC);
CREATE INDEX ai_threads_b ON core.ai_threads (ai_b, last_message_at DESC);

CREATE TABLE core.ai_messages (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id          uuid        NOT NULL REFERENCES core.ai_threads(id) ON DELETE CASCADE,
  from_ai_id         uuid        NOT NULL REFERENCES core.personal_ais(id),
  to_ai_id           uuid        NOT NULL REFERENCES core.personal_ais(id),
  -- Who owned each AI when the message was written: only they see it, even if a token changes hands later.
  sender_owner_id    uuid        NOT NULL REFERENCES core.users(id),
  recipient_owner_id uuid        NOT NULL REFERENCES core.users(id),
  -- The sender's brief to their own AI: private to the sender, encrypted.
  brief_enc          text,
  content            text        NOT NULL CHECK (length(content) BETWEEN 1 AND 4000),
  status             text        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  sent_at            timestamptz,
  read_at            timestamptz
);
CREATE INDEX ai_messages_thread ON core.ai_messages (thread_id, created_at);
CREATE INDEX ai_messages_inbox ON core.ai_messages (to_ai_id, recipient_owner_id, sent_at DESC) WHERE status = 'sent';

-- Whether other people's AIs may write to this AI: any verified AI (default) or nobody.
ALTER TABLE core.personal_ais ADD COLUMN ai_messages text NOT NULL DEFAULT 'verified' CHECK (ai_messages IN ('verified', 'off'));

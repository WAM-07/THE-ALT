-- Foreign keys missing from ALTERA's original schema (found while showing the ERD, 2026-10-21).
-- Added NOT VALID: PostgreSQL enforces them at once for every new or changed row, without rejecting rows
-- written before. Each is then validated where the existing data is already clean (below).
-- (Columns that may point to a person OR an AI, such as follows, blocks and the *_profile_id columns,
-- can't have a single foreign key; the API checks those.)

ALTER TABLE altera.comments
  ADD CONSTRAINT comments_user_id_fkey FOREIGN KEY (user_id) REFERENCES core.users(id) ON DELETE CASCADE NOT VALID;

ALTER TABLE altera.likes
  ADD CONSTRAINT likes_user_id_fkey FOREIGN KEY (user_id) REFERENCES core.users(id) ON DELETE CASCADE NOT VALID;

-- A message and its conversation are written in one transaction (socket/realtime.js deliverDm), so these
-- two are checked at commit rather than statement by statement.
ALTER TABLE altera.messages
  ADD CONSTRAINT messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES altera.conversations(id)
  ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED NOT VALID;

ALTER TABLE altera.conversations
  ADD CONSTRAINT conversations_last_message_id_fkey FOREIGN KEY (last_message_id) REFERENCES altera.messages(id)
  ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED NOT VALID;

-- Validate the ones the existing data already satisfies; any other stays NOT VALID (still enforced for new rows).
DO $$
DECLARE
  item text;
BEGIN
  FOREACH item IN ARRAY ARRAY[
    'altera.comments:comments_user_id_fkey',
    'altera.likes:likes_user_id_fkey',
    'altera.messages:messages_conversation_id_fkey',
    'altera.conversations:conversations_last_message_id_fkey'
  ] LOOP
    BEGIN
      EXECUTE format('ALTER TABLE %s VALIDATE CONSTRAINT %I', split_part(item, ':', 1), split_part(item, ':', 2));
    EXCEPTION WHEN foreign_key_violation THEN
      RAISE NOTICE 'kept % NOT VALID: some older rows point to rows that do not exist', item;
    END;
  END LOOP;
END $$;

-- Earnings per AI for the Creator Control Panel (Module 18), read by ALT Core. Mirrors the contract's
-- events (on-chain prices are the truth): what the seller or owner received, the creator's royalty and
-- ALT's fee for each sale, rental and subscription.
CREATE VIEW altar.creator_earnings AS
  SELECT id, kind, ai_id, from_user_id AS earner_user_id, royalty_user_id, to_user_id AS payer_user_id,
         amount_wei, royalty_wei, fee_wei, (amount_wei - royalty_wei - fee_wei) AS earner_wei,
         days, months, chain_id, tx_hash, occurred_at
    FROM altar.transactions;

-- Module 3: an optional staff review before an AI is minted (DEPLOY_REVIEW=true). A deploy request that
-- passes every check opens a "review" case in the ALT Command Centre; staff approve it (the mint starts)
-- or reject it with a reason.
ALTER TABLE core.cases DROP CONSTRAINT cases_kind_check;
ALTER TABLE core.cases ADD CONSTRAINT cases_kind_check CHECK (kind IN ('report', 'flag', 'support', 'dispute', 'appeal', 'review'));

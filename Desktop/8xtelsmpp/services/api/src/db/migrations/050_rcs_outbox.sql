CREATE TABLE IF NOT EXISTS rcs_outbox (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  message_id UUID NOT NULL REFERENCES rcs_messages(id) ON DELETE CASCADE,
  queue_name TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','published')),
  attempts INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ,
  UNIQUE(message_id, queue_name)
);
CREATE INDEX IF NOT EXISTS idx_rcs_outbox_pending ON rcs_outbox(state,id);

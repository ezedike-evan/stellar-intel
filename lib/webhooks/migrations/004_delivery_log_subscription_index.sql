CREATE INDEX IF NOT EXISTS idx_webhook_delivery_log_subscription
  ON webhook_delivery_log (subscription_id, created_at DESC);

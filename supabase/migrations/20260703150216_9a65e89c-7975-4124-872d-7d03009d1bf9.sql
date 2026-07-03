
SELECT cron.schedule(
  'verify-ton-deposits',
  '*/2 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--88f1a58d-13ac-47b7-9a09-3414d6926b10-dev.lovable.app/api/public/verify-deposits',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);

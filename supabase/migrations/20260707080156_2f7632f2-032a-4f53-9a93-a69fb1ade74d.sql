SELECT cron.unschedule('verify-ton-deposits');
SELECT cron.schedule(
  'verify-ton-deposits',
  '*/2 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--88f1a58d-13ac-47b7-9a09-3414d6926b10.lovable.app/api/public/verify-deposits',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer 99c046fbfa30db6e9af6cbc3ff5a3ed1adcc4c4f6b8ca1d68a693633671e5136"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
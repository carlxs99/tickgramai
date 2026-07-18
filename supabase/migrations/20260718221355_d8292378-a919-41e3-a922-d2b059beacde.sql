SELECT net.http_post(
  url := 'https://project--88f1a58d-13ac-47b7-9a09-3414d6926b10-dev.lovable.app/api/public/hooks/daily-checkin-broadcast?chat_id=6334940213',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1)
  ),
  body := '{}'::jsonb
);
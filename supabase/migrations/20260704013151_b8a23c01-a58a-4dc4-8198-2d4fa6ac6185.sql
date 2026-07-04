-- Update the invite task description to use the real app name
UPDATE public.tasks
SET description = 'Invite a friend to TICK GRAM AI'
WHERE code = 'share_friends';

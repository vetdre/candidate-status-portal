revoke all on table public.portal_freshness_monitor_v1 from anon;
revoke all on table public.portal_freshness_monitor_v1 from authenticated;

grant select on table public.portal_freshness_monitor_v1 to service_role;

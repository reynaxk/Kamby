-- Railway's Postgres container has a 64 MB /dev/shm. Parallel query workers allocate their
-- shared memory there, and on 2026-10-31 trader-profile aggregates over swaps failed with
-- "could not resize shared memory segment ... No space left on device" (53100), which then
-- starved the connection pool for every other route. Index scans don't need parallel
-- workers, so turn them off for this database. Applies to new connections (restart the api).
DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET max_parallel_workers_per_gather = 0', current_database());
END
$$;

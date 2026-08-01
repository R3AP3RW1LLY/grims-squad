/**
 * Putting worker activity on the admin area's live log.
 *
 * ★ SQUADRON OWNER, 2026-08-01 ★
 *
 * "add all ingesting and embedding to the live log found on this page please! /app?tab=moderation"
 *
 * ★ WHY THIS IS NOT JUST A FUNCTION CALL ★
 *
 * The live log is `AiStreamService`, and it is IN MEMORY inside the API process. The worker is a
 * different container — started by cron, run to completion, thrown away. It cannot reach that
 * object, and there is no shared process to put one in.
 *
 * ★ pg_notify, NOT AN HTTP ENDPOINT ★
 *
 * The obvious alternative is the worker POSTing to the API. That means inventing an internal
 * endpoint, authenticating one of our own services to another, and handling the API being down
 * while a job is mid-import.
 *
 * Both processes already hold a Postgres connection. `NOTIFY` is push, arrives in milliseconds,
 * needs no port, no credential and no retry — and when nobody is listening it costs nothing and is
 * silently discarded, which is exactly the behaviour wanted for a log line.
 *
 * ★ FIRE AND FORGET, ALWAYS ★
 *
 * A log line that fails must never fail the import it is describing. Every call here swallows its
 * own errors: the job is the thing that matters and it has already done the work.
 */

/*
 * ★ THE CHANNEL AND THE ENCODING MOVED TO THE CONTRACT ★
 *
 * They used to live here, and the API's listener had its own copy of the name. Two definitions of a
 * string that only works when both sides agree, with nothing to make them agree — and a NOTIFY to
 * the wrong channel fails silently, so the drift would have shown up as a live log that simply
 * never scrolled.
 *
 * Re-exported rather than removed: the worker's callers import `announce` from here, and the
 * collector imports it from the contract directly. Same function either way.
 */
export { JOB_LOG_CHANNEL, announce, type JobLogLine } from '@grims/shared';

// One error type for every API answer HiveXUI reads. Bodies are normalised by
// @hivemagnus/hive-common/errors, which knows every error shape the suite has sent (the standard
// envelope, Magnus, Oathweave, OAuth, HiveMem, ChatterMost, plain text, ...). Only the isomorphic
// `/errors` and `/contracts` subpaths are imported here: the others need Node.
//
// This module is kept apart from transport.ts, which re-exports it, so tests that replace the
// transport with a stub still get the real error classes.
import { HIVE_HEADERS } from '@hivemagnus/hive-common/contracts';
import {
  defaultCodeForStatus,
  defaultMessageForStatus,
  parseHiveError,
  parseHiveErrorResponse,
  type HiveError,
  type HiveErrorShape,
} from '@hivemagnus/hive-common/errors';

export type { HiveErrorShape } from '@hivemagnus/hive-common/errors';

export const REQUEST_ID_HEADER = HIVE_HEADERS.requestId;
/** Older products answer with one of these instead of x-request-id. */
const REQUEST_ID_ALIASES: readonly string[] = HIVE_HEADERS.requestIdAliases;

export interface HiveApiErrorOptions {
  /** The product's own code, as sent. Undefined when the answer carried none. */
  code?: string | undefined;
  /** The request ID to quote when reporting the failure. */
  requestId?: string | undefined;
  /** Structured data from the answer, such as validation issues. */
  details?: unknown;
  /** Which error body shape the answer used (`envelope`, `magnus`, `fastapi`, ...). */
  shape?: HiveErrorShape | undefined;
  /** From Retry-After, when the answer had one. */
  retryAfterMs?: number | undefined;
  cause?: unknown;
}
/** What a subclass passes through without naming each field. */
export type HiveApiErrorMeta = Omit<HiveApiErrorOptions, 'code'>;

/**
 * A failed API request. `message` is always written for the operator: the product's own message
 * when it sent one, otherwise the caller's fallback. Product clients subclass it where pages tell
 * products apart with `instanceof`.
 */
export class HiveApiError extends Error {
  override name = 'HiveApiError';
  readonly status: number;
  readonly code: string | undefined;
  readonly requestId: string | undefined;
  readonly details: unknown;
  readonly shape: HiveErrorShape | undefined;
  readonly retryAfterMs: number | undefined;

  constructor(status: number, message: string, options: HiveApiErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.status = status;
    this.code = options.code;
    this.requestId = options.requestId;
    this.details = options.details;
    this.shape = options.shape;
    this.retryAfterMs = options.retryAfterMs;
  }

  /** The code to compare against: the product's, or the suite default for the status (`not_found`). */
  get hiveCode(): string {
    return this.code ?? defaultCodeForStatus(this.status);
  }

  /** True for a HiveApiError, optionally with this code (case-insensitive). */
  static is(error: unknown, code?: string): error is HiveApiError {
    if (!(error instanceof HiveApiError)) return false;
    return code === undefined || error.hiveCode.toLowerCase() === code.toLowerCase();
  }
}

/**
 * A success answer that does not match the released contract. Nothing from it is shown. It shares
 * the base class with failed requests, so one `instanceof HiveApiError` covers both.
 */
export class HiveContractError extends HiveApiError {
  override name = 'HiveContractError';
  constructor(
    message: string,
    /** The method changes state, so the change was applied even though the answer was unreadable. */
    readonly applied: boolean,
    status = 200,
    meta: HiveApiErrorMeta = {},
  ) {
    super(status, message, { ...meta, code: 'contract_mismatch' });
  }
}

const unreadable = (product: string, applied: boolean): string =>
  applied
    ? `The change was sent, but ${product} answered in a format this version of HiveXUI cannot read. Refresh to confirm the result.`
    : `${product} answered in a format this version of HiveXUI cannot read.`;

/** Anything with zod's `safeParse`. Kept structural so this module needs no schema library. */
export interface AnswerSchema<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}

/**
 * A success answer, checked against its contract. A mismatch is a HiveContractError written for
 * the operator, never the schema library's issue list. `applied` is true for a method that changes
 * state: the change went through even though its result could not be read.
 */
export function parseAnswer<T>(schema: AnswerSchema<T>, value: unknown, product: string, applied = false): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new HiveContractError(unreadable(product, applied), applied);
}

/**
 * The JSON body of a success answer. A body that is not JSON (a page served in the product's
 * place, an empty answer) is a HiveContractError, not the parser's syntax error.
 */
export async function readJsonAnswer(response: Response, product: string, applied = false): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch (cause) {
    // An aborted read is the caller's own doing and keeps its reason.
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new HiveContractError(unreadable(product, applied), applied, response.status, { requestId: responseRequestId(response), cause });
  }
}

/** The request ID this client sent, per response, for answers that do not echo one. */
const sentRequestIds = new WeakMap<Response, string>();
export function rememberSentRequestId(response: Response, requestId: string): void {
  if (typeof response === 'object' && response !== null) sentRequestIds.set(response, requestId);
}

const SAFE_REQUEST_ID = /^[A-Za-z0-9._:@/+=-]{1,128}$/;
/** Random, without crypto.randomUUID, which is missing outside a secure context. */
export function createRequestId(): string {
  if (typeof crypto.randomUUID === 'function') {
    try {
      return crypto.randomUUID();
    } catch {
      // Not a secure context.
    }
  }
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * The request ID of an answer: x-request-id, then the older x-hive-request-id and x-correlation-id,
 * then the ID this client sent with the request.
 */
export function responseRequestId(response: Response): string | undefined {
  for (const name of [REQUEST_ID_HEADER, ...REQUEST_ID_ALIASES]) {
    const value = response.headers?.get(name)?.trim();
    if (value && SAFE_REQUEST_ID.test(value)) return value;
  }
  return sentRequestIds.get(response);
}

/** Retry-After as milliseconds: delta-seconds or an HTTP date. */
export function retryAfterMs(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

export interface FailureOptions {
  /** The message when the answer carries none of its own, or is not trusted to. */
  fallback?: string | ((status: number) => string) | undefined;
  /** False keeps the product's message out of `message` (it stays on `remoteMessage`). */
  trustMessage?: boolean | undefined;
}

/** A failed answer, normalised: everything a product client needs to build its error. */
export interface ApiFailure extends HiveApiErrorOptions {
  status: number;
  message: string;
  /** The product's own message, if it sent one. */
  remoteMessage: string | undefined;
  /** The parsed JSON body, or the text when it was not JSON. Null when empty. */
  body: unknown;
  /** The normalised error from hive-common, with the suite's default code and message filled in. */
  hive: HiveError;
}

const CODED_SHAPES: ReadonlySet<HiveErrorShape> = new Set(['code', 'oathweave', 'oauth', 'mattermost']);
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
/** Whether the product sent a code, rather than hive-common filling in the status default. */
function sentCode(hive: HiveError, body: unknown): boolean {
  if (hive.shape && CODED_SHAPES.has(hive.shape)) return true;
  if (hive.code !== defaultCodeForStatus(hive.status)) return true;
  if (!isRecord(body)) return false;
  const inner = body['error'];
  return isRecord(inner) ? typeof inner['code'] === 'string' || typeof inner['type'] === 'string' : typeof body['code'] === 'string';
}

/**
 * Emberpath's `{error: "human text", code: "stable_code"}`: hive-common reads the text and fills in
 * the status default for the code, so the code the product sent beside it is taken from the body.
 */
function siblingCode(hive: HiveError, body: unknown): string | undefined {
  if (hive.shape !== 'string' || !isRecord(body)) return undefined;
  const code = body['code'];
  return typeof code === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(code) ? code : undefined;
}

function toFailure(status: number, hive: HiveError, body: unknown, requestId: string | undefined, retryAfter: string | null, options: FailureOptions): ApiFailure {
  // hive-common fills a missing code or message with the status default; the clients keep their
  // own fallbacks and treat a code as absent unless the product sent one.
  const remoteCode = sentCode(hive, body) ? siblingCode(hive, body) ?? hive.code : undefined;
  const remoteMessage = hive.message !== defaultMessageForStatus(hive.status) ? hive.message : undefined;
  const fallback = typeof options.fallback === 'function' ? options.fallback(status) : options.fallback ?? hive.message;
  const message = options.trustMessage === false ? fallback : remoteMessage ?? fallback;
  const wait = retryAfterMs(retryAfter);
  return {
    status,
    message,
    remoteMessage,
    code: remoteCode,
    requestId: hive.requestId ?? requestId,
    details: hive.details,
    shape: hive.shape,
    ...(wait === undefined ? {} : { retryAfterMs: wait }),
    body,
    hive,
  };
}

function parseBody(text: string): unknown {
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Read a failed answer. Never throws: an unreadable body falls back to the status. The response
 * body is consumed.
 */
export async function readApiFailure(response: Response, options: FailureOptions = {}): Promise<ApiFailure> {
  let text = '';
  let hive: HiveError;
  try {
    [hive, text] = await Promise.all([parseHiveErrorResponse(response.clone()), response.text().catch(() => '')]);
  } catch {
    // A body that was already read cannot be cloned.
    hive = parseHiveError(response.status, '');
  }
  return toFailure(response.status, hive, parseBody(text), responseRequestId(response), response.headers?.get('retry-after') ?? null, options);
}

/** The same, for a body the caller has already read. */
export function apiFailureFromBody(status: number, body: unknown, options: FailureOptions & { response?: Response | undefined } = {}): ApiFailure {
  const requestId = options.response ? responseRequestId(options.response) : undefined;
  const hive = parseHiveError(status, body, requestId ? { requestId } : {});
  return toFailure(status, hive, body ?? null, requestId, options.response?.headers?.get('retry-after') ?? null, options);
}

/** The fields of a failure to pass to an error constructor. */
export function failureMeta(failure: ApiFailure): HiveApiErrorMeta {
  return {
    requestId: failure.requestId,
    details: failure.details,
    shape: failure.shape,
    retryAfterMs: failure.retryAfterMs,
  };
}

/** A HiveApiError from a failed answer. */
export async function hiveApiError(response: Response, options: FailureOptions = {}): Promise<HiveApiError> {
  const failure = await readApiFailure(response, options);
  return new HiveApiError(failure.status, failure.message, { ...failureMeta(failure), code: failure.code });
}

/** A message with its request ID, for an operator to quote when reporting a failure. */
export function describeApiError(error: unknown, fallback = 'The request failed'): string {
  const message = error instanceof Error && error.message ? error.message : fallback;
  return error instanceof HiveApiError && error.requestId ? `${message} (request ${error.requestId})` : message;
}

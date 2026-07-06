// ── Typed API errors ─────────────────────────────────────────────────────────
//
// The router maps these to HTTP status codes centrally (see router.ts). Keeping
// them as named classes lets any layer (persist funnel, handlers) signal intent
// — "this is a lock conflict", "this resource is missing" — without knowing or
// caring about HTTP.

/**
 * Thrown when a mutation is attempted against a board that currently holds an
 * AI-editing lock. The router maps this to HTTP 409 (Conflict).
 */
export class LockedError extends Error {
  constructor(message = 'locked') {
    super(message);
    this.name = 'LockedError';
  }
}

/**
 * Thrown when a requested board / sub-board / snapshot does not exist. The
 * router maps this to HTTP 404. Handlers can throw it directly; the router also
 * recognises the repository's "not found" read errors by message and maps those
 * to 404 as a fallback.
 */
export class NotFoundError extends Error {
  constructor(message = 'not_found') {
    super(message);
    this.name = 'NotFoundError';
  }
}

/**
 * Thrown for client-supplied input that fails validation (bad slug/path, an
 * invalid board/comments/tags payload, a missing required field). The router
 * maps this to HTTP 400.
 */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

// Typed errors for lib/db. Routes map them: DbUnavailableError → 503 `unavailable`, DbError → 500 `internal`.

/** Sample mode for an operation that needs a real DB, or a missing key. */
export class DbUnavailableError extends Error {
  constructor(message = "Database is not configured") {
    super(message);
    this.name = "DbUnavailableError";
  }
}

/** The database (or PostgREST) returned an error. The cause is kept for server logs only. */
export class DbError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "DbError";
  }
}

/** content/prices.csv or content/help.json failed validation. `where` is "prices.csv:12" or "help.json:contacts[3].phone". */
export class SampleDataError extends Error {
  readonly where: string;
  constructor(where: string, message: string) {
    super(`${where}: ${message}`);
    this.name = "SampleDataError";
    this.where = where;
  }
}

/** An admin body failed validation. `fields` = path → message (ApiError.error.fields). Maps to 400 bad_request. */
export class ValidationError extends Error {
  constructor(
    readonly fields: Record<string, string>,
    message = "Invalid fields.",
  ) {
    super(message);
    this.name = "ValidationError";
  }
}

/** A unique key is already taken. Maps to 409 conflict. */
export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}

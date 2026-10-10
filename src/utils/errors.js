/**
 * An error that is safe to show to the user. `status` becomes the HTTP status,
 * `code` gives the frontend something stable to switch on.
 */
export class AppError extends Error {
  constructor(message, status = 400, code = 'BAD_REQUEST', details = undefined) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.expose = true;
  }
}

export const notFound = (what = 'Resource') => new AppError(`${what} not found.`, 404, 'NOT_FOUND');

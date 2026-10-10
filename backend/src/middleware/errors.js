import multer from 'multer';
import mongoose from 'mongoose';
import { config } from '../config.js';
import { AppError } from '../utils/errors.js';

export function notFoundHandler(req, _res, next) {
  next(new AppError(`No route for ${req.method} ${req.path}`, 404, 'NOT_FOUND'));
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  let status = 500;
  let body = { error: 'Something went wrong on our side. Please try again.', code: 'INTERNAL' };

  if (err instanceof AppError) {
    status = err.status;
    body = { error: err.message, code: err.code, ...(err.details ? { details: err.details } : {}) };
  } else if (err instanceof multer.MulterError) {
    status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    body = {
      error:
        err.code === 'LIMIT_FILE_SIZE'
          ? `That video is too big. The limit is ${config.maxUploadMb} MB. Trim the clip and try again.`
          : `Upload problem: ${err.message}. Send one video in a form field called "clip".`,
      code: err.code,
    };
  } else if (err instanceof mongoose.Error.CastError) {
    status = 400;
    body = { error: `Invalid ${err.path}.`, code: 'BAD_ID' };
  } else if (err instanceof mongoose.Error.ValidationError) {
    status = 400;
    body = { error: Object.values(err.errors).map((e) => e.message).join(' '), code: 'VALIDATION' };
  } else if (err?.type === 'entity.parse.failed') {
    status = 400;
    body = { error: 'Request body is not valid JSON.', code: 'BAD_JSON' };
  }

  if (status >= 500) console.error(`[${req.method} ${req.path}]`, err);
  res.status(status).json(body);
}

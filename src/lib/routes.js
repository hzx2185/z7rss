import { formatErrorResponse, normalizeError, notFound } from "./errors.js";

export function route(handler) {
  return function wrappedRoute(req, res, next) {
    try {
      Promise.resolve(handler(req, res, next)).catch(next);
    } catch (error) {
      next(error);
    }
  };
}

export function notFoundHandler(_req, res) {
  const error = notFound("接口不存在");
  res.status(error.status).json(formatErrorResponse(error));
}

export function errorHandler(error, req, res, _next) {
  if (res.headersSent) {
    return;
  }

  const normalized = normalizeError(error);

  if (normalized.status >= 500) {
    console.error(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
    console.error(error);
  }

  res.status(normalized.status).json(formatErrorResponse(normalized));
}

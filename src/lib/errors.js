const DEFAULT_CODE_BY_STATUS = {
  400: "bad_request",
  401: "unauthorized",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
  422: "unprocessable_entity",
  429: "rate_limited",
  500: "internal_error",
  502: "bad_gateway",
  503: "service_unavailable"
};

export class AppError extends Error {
  constructor(status, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = "AppError";
    this.status = Number(status) || 500;
    this.code = options.code || DEFAULT_CODE_BY_STATUS[this.status] || "error";
    this.expose = options.expose ?? this.status < 500;
    if (options.details !== undefined) {
      this.details = options.details;
    }
  }
}

export function createError(status, message, options = {}) {
  return new AppError(status, message, options);
}

export function badRequest(message, options) {
  return createError(400, message, options);
}

export function unauthorized(message, options) {
  return createError(401, message, options);
}

export function forbidden(message, options) {
  return createError(403, message, options);
}

export function notFound(message, options) {
  return createError(404, message, options);
}

export function conflict(message, options) {
  return createError(409, message, options);
}

export function badGateway(message, options) {
  return createError(502, message, options);
}

export function serviceUnavailable(message, options) {
  return createError(503, message, options);
}

export function normalizeError(error) {
  if (error instanceof AppError) {
    return error;
  }

  if (error?.type === "entity.parse.failed") {
    return badRequest("请求体 JSON 格式无效", { code: "invalid_json" });
  }

  if (typeof error?.status === "number" && error?.message) {
    return createError(error.status, error.message, {
      code: error.code,
      expose: error.expose
    });
  }

  if (error?.code && String(error.code).startsWith("SQLITE_CONSTRAINT")) {
    return conflict("请求与现有数据冲突", { code: "sqlite_constraint" });
  }

  return createError(500, "服务器开小差了，请稍后重试", {
    code: "internal_error",
    expose: false,
    cause: error
  });
}

export function formatErrorResponse(error) {
  const payload = {
    error: error.message,
    code: error.code
  };

  if (error.details !== undefined) {
    payload.details = error.details;
  }

  return payload;
}

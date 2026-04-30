import net from "node:net";
import { badRequest } from "./errors.js";

function fail(message, details) {
  throw badRequest(message, details ? { details } : undefined);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function expectObject(value, label = "请求体") {
  if (!isPlainObject(value)) {
    fail(`${label}必须是 JSON 对象`);
  }
  return value;
}

export function parseTrimmedString(value, label, options = {}) {
  const required = options.required ?? false;
  const maxLength = options.maxLength ?? null;
  const allowEmpty = options.allowEmpty ?? !required;
  const normalized = value === undefined || value === null ? "" : String(value);
  const trimmed = normalized.trim();

  if (!trimmed) {
    if (!allowEmpty) {
      fail(`${label}不能为空`);
    }
    return "";
  }

  if (maxLength && trimmed.length > maxLength) {
    fail(`${label}长度不能超过 ${maxLength} 个字符`);
  }

  return trimmed;
}

export function parseEmail(value, label = "邮箱") {
  const email = parseTrimmedString(value, label, { required: true, maxLength: 320 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    fail(`请输入有效的${label}`);
  }
  return email;
}

export function parsePassword(value, label = "密码", options = {}) {
  const minLength = options.minLength ?? 8;
  const maxLength = options.maxLength ?? 256;
  const password = value === undefined || value === null ? "" : String(value);

  if (password.length < minLength) {
    fail(`${label}至少需要 ${minLength} 位`);
  }
  if (password.length > maxLength) {
    fail(`${label}长度不能超过 ${maxLength} 位`);
  }

  return password;
}

export function parseBoolean(value, label, options = {}) {
  const allowNull = options.allowNull ?? false;
  const allowUndefined = options.allowUndefined ?? false;

  if (value === undefined) {
    if (allowUndefined) return undefined;
    fail(`${label}必须是布尔值`);
  }
  if (value === null) {
    if (allowNull) return null;
    fail(`${label}必须是布尔值`);
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (value === 1 || value === "1" || value === "true") {
    return true;
  }
  if (value === 0 || value === "0" || value === "false") {
    return false;
  }
  fail(`${label}必须是布尔值`);
}

export function parsePositiveInt(value, label, options = {}) {
  const allowNull = options.allowNull ?? false;
  const allowUndefined = options.allowUndefined ?? false;
  const min = options.min ?? 1;
  const max = options.max ?? Number.MAX_SAFE_INTEGER;

  if (value === undefined) {
    if (allowUndefined) return undefined;
    fail(`${label}必须是整数`);
  }
  if (value === null || value === "") {
    if (allowNull) return null;
    fail(`${label}必须是整数`);
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    fail(`${label}必须是 ${min} 到 ${max} 之间的整数`);
  }

  return parsed;
}

export function parseEnum(value, label, allowedValues, options = {}) {
  const allowNull = options.allowNull ?? false;
  const allowUndefined = options.allowUndefined ?? false;
  const normalize = options.normalize ?? ((input) => String(input));

  if (value === undefined) {
    if (allowUndefined) return undefined;
    fail(`${label}无效`);
  }
  if (value === null || value === "") {
    if (allowNull) return null;
    fail(`${label}无效`);
  }

  const candidate = normalize(value);
  if (!allowedValues.includes(candidate)) {
    fail(`${label}无效`);
  }

  return candidate;
}

export function parseUrl(value, label = "链接", options = {}) {
  const required = options.required ?? true;
  const allowedProtocols = options.allowedProtocols ?? ["http:", "https:"];
  const raw = value === undefined || value === null ? "" : String(value).trim();

  if (!raw) {
    if (!required) return "";
    fail(`${label}不能为空`);
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch (_error) {
    fail(`${label}格式无效`);
  }

  if (!allowedProtocols.includes(parsed.protocol)) {
    fail(`${label}格式无效`);
  }

  return parsed.toString();
}

export function parseIsoDateTime(value, label, options = {}) {
  const allowNull = options.allowNull ?? false;
  const allowUndefined = options.allowUndefined ?? false;
  const raw = value === undefined || value === null ? "" : String(value).trim();

  if (!raw) {
    if (allowNull || allowUndefined) return null;
    fail(`${label}格式无效`);
  }

  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00.000Z` : raw;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    fail(`${label}格式无效`);
  }
  return raw;
}

export function parseIntegerArray(value, label, options = {}) {
  const maxItems = options.maxItems ?? 1000;
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    fail(`${label}必须是数组`);
  }
  if (value.length > maxItems) {
    fail(`${label}数量不能超过 ${maxItems} 个`);
  }

  return value.map((entry, index) => parsePositiveInt(entry, `${label}第 ${index + 1} 项`, { min: 1 }));
}

export function parseHostname(value, label = "域名") {
  const hostname = parseTrimmedString(value, label, { required: true, maxLength: 255 }).toLowerCase();
  if (!/^(?=.{1,255}$)(?!-)(?:[a-z0-9-]{1,63}\.)+[a-z]{2,63}$/.test(hostname) && !/^[a-z0-9-]+(?:\.[a-z0-9-]+)*$/.test(hostname)) {
    fail(`${label}格式无效`);
  }
  return hostname;
}

export function parseIpAddress(value, label = "IP") {
  const ip = parseTrimmedString(value, label, { required: true, maxLength: 64 });
  if (!net.isIP(ip)) {
    fail(`${label}格式无效`);
  }
  return ip;
}

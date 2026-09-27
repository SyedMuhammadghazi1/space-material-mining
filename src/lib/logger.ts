import pino from "pino";

const level = process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "test" ? "silent" : "info");
const pretty = process.env.NODE_ENV === "development" && process.env.LOG_PRETTY !== "0";

/**
 * Structured JSON logger. Secrets and PII are redacted by path; never log request bodies,
 * API keys, tokens or passwords.
 */
export const logger = pino({
  level,
  base: { service: "orbital-quarry" },
  redact: {
    paths: [
      "password",
      "*.password",
      "apiKey",
      "*.apiKey",
      "token",
      "*.token",
      "authorization",
      "*.authorization",
      "headers.authorization",
      "headers.cookie",
      "email",
      "*.email",
    ],
    censor: "[redacted]",
  },
  ...(pretty
    ? { transport: { target: "pino-pretty", options: { colorize: true, singleLine: true } } }
    : {}),
});

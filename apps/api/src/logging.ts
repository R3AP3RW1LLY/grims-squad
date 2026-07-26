import pino from 'pino';

/**
 * Structured JSON logging, request-ID correlated across web → api → gsai.
 *
 * The redaction list is not optional (ssot/CONVENTIONS.md): tokens, secrets, raw
 * telemetry payloads, AI conversation content, email addresses and plaintext IPs
 * must never reach a log. A leaked token in a log file is a leaked token.
 */
export const logger = pino({
  level: process.env['LOG_LEVEL'] ?? (process.env['NODE_ENV'] === 'production' ? 'info' : 'debug'),
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-csrf-token"]',
      'res.headers["set-cookie"]',
      '*.password',
      '*.token',
      '*.accessToken',
      '*.refreshToken',
      '*.tokenHash',
      '*.apiKey',
      '*.secret',
      '*.email',
      '*.payload',
      '*.content',
    ],
    censor: '[redacted]',
  },
  formatters: {
    level: (label) => ({ level: label }),
  },
  // Pretty output in development only. Production emits raw JSON for Loki.
  ...(process.env['NODE_ENV'] !== 'production'
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
        },
      }
    : {}),
});

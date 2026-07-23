// Shared browser-like fetch helper for sources that block automated clients.
//
// Why this exists:
//   Some sources (notably nanog.org) sit behind a WAF that blocks requests by
//   client fingerprint. A bare bot User-Agent gets HTTP 403/402. Sending a full
//   browser header set is NOT sufficient from Node: node's TLS ClientHello has a
//   different fingerprint than a real browser, so node's https module is blocked
//   even with perfect headers. curl.exe (present on this Windows + PowerShell
//   setup, and already used in Phase 1) produces a browser-compatible TLS
//   handshake and passes.
//
//   Strategy: try node https first (fast, no child process). If it returns a
//   block status (403/402/429/503) or errors, fall back to curl.exe with the
//   full browser header set. This keeps working sources fast while transparently
//   recovering blocked ones.
//
// Verified 2026-07-23: node https -> 403 on nanog.org even with browser headers;
// curl.exe --compressed + these headers -> 200.

import { get as httpsGet } from "node:https";
import { execFile } from "node:child_process";

// Header set that a real Chrome sends. NOTE: Accept-Encoding is deliberately
// omitted from the node path (node would receive gzip/br and callers here parse
// plain text); curl handles decompression itself via --compressed.
export const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-Dest": "document",
  "Upgrade-Insecure-Requests": "1",
};

const BLOCK_STATUSES = new Set([401, 402, 403, 406, 429, 503]);
const DEFAULT_TIMEOUT_MS = 30_000;

function nodeFetch(url, { timeoutMs = DEFAULT_TIMEOUT_MS, referer, maxRedirects = 5 } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { ...BROWSER_HEADERS };
    if (referer) headers.Referer = referer;

    const req = httpsGet(url, { headers }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        if (maxRedirects <= 0) return reject(new Error(`Too many redirects for ${url}`));
        res.resume();
        const target = new URL(res.headers.location, url).href;
        return resolve(
          nodeFetch(target, { timeoutMs, referer, maxRedirects: maxRedirects - 1 })
        );
      }
      if (res.statusCode !== 200) {
        res.resume();
        const err = new Error(`HTTP ${res.statusCode} for ${url}`);
        err.statusCode = res.statusCode;
        return reject(err);
      }
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    });

    req.on("error", reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error(`Timeout fetching ${url}`));
    });
  });
}

// Fetch via curl.exe with a browser-compatible TLS handshake + headers.
// Bypasses WAFs that block node's TLS fingerprint. Windows: curl.exe is the
// Microsoft-shipped curl and is on PATH (also used in the Phase 1 pipeline).
export function fetchViaCurl(url, { timeoutMs = DEFAULT_TIMEOUT_MS, referer } = {}) {
  return new Promise((resolve, reject) => {
    const headerArgs = Object.entries(BROWSER_HEADERS).flatMap(([k, v]) => ["-H", `${k}: ${v}`]);
    if (referer) headerArgs.push("-H", `Referer: ${referer}`);
    const args = [
      "-sSL",
      "--compressed",
      "--max-time",
      String(Math.ceil(timeoutMs / 1000)),
      ...headerArgs,
      url,
    ];
    execFile(
      "curl.exe",
      args,
      { maxBuffer: 64 * 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        if (error) return reject(new Error(`curl.exe failed for ${url}: ${stderr || error.message}`));
        if (!stdout || !stdout.trim()) return reject(new Error(`curl.exe returned empty body for ${url}`));
        resolve(stdout);
      }
    );
  });
}

// Primary entry point: try node https, fall back to curl.exe on block/error.
// Returns the response body as a string.
export async function fetchText(url, options = {}) {
  try {
    return await nodeFetch(url, options);
  } catch (error) {
    const status = error && error.statusCode;
    const shouldRetryWithCurl = !status || BLOCK_STATUSES.has(status) || /timeout/i.test(error.message);
    if (!shouldRetryWithCurl) throw error;
    return fetchViaCurl(url, options);
  }
}

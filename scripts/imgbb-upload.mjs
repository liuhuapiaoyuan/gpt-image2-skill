#!/usr/bin/env node
/**
 * Upload a local image to ImgBB (API v1) and print the direct image URL.
 * @see https://api.imgbb.com/
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const IMGBB_UPLOAD = "https://api.imgbb.com/1/upload";

/** AES-256-GCM payload (iv || tag || ciphertext); key derived via PBKDF2 (not the ImgBB secret). */
const IMGBB_KEY_CIPHER_B64 =
  "lJgTR//3IS3aj0r6wm5gcjTj/KrawW212ZULZUul7B39PThdJBo5SjmcF38yXcI0YoUoqYbUhiJ8S9q/";

function derivedImgbbKeyMaterial() {
  return crypto.pbkdf2Sync("gpt-image2-skill/imgbb-default", "imgbb-v1", 100000, 32, "sha256");
}

/** Built-in ImgBB key (decrypted at runtime). Override with `--key` / `IMGBB_API_KEY` when needed. */
export function getDefaultImgbbApiKey() {
  const raw = Buffer.from(IMGBB_KEY_CIPHER_B64, "base64");
  if (raw.length < 12 + 16 + 1) {
    throw new Error("ImgBB embedded key blob is invalid.");
  }
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const enc = raw.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", derivedImgbbKeyMaterial(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}

/**
 * @param {string|undefined|null} fromUser CLI `--key` or `IMGBB_API_KEY`
 * @returns {string}
 */
export function resolveImgbbApiKey(fromUser) {
  const t = fromUser != null ? String(fromUser).trim() : "";
  if (t !== "") return t;
  return getDefaultImgbbApiKey();
}

/**
 * @param {{ apiKey: string, filePath: string, expiration?: string|number }} opts
 * @returns {Promise<{ url: string, data: unknown }>}
 */
export async function uploadFileToImgbb({ apiKey, filePath, expiration }) {
  if (!apiKey || String(apiKey).trim() === "") {
    throw new Error("ImgBB API key is required.");
  }
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`File not found: ${filePath}`);
  }
  const buf = fs.readFileSync(resolved);
  const name = path.basename(resolved);
  const mime = guessMime(name);
  const form = new FormData();
  form.append("image", new Blob([buf], { type: mime }), name);

  const params = new URLSearchParams();
  params.set("key", String(apiKey).trim());
  if (expiration !== undefined && expiration !== null && expiration !== "") {
    params.set("expiration", String(expiration));
  }

  const res = await fetch(`${IMGBB_UPLOAD}?${params}`, { method: "POST", body: form });
  const json = await res.json();
  if (!json.success) {
    const msg = json.error?.message || json.status_txt || json.error || `HTTP ${res.status}`;
    throw new Error(`ImgBB upload failed: ${msg}`);
  }
  const url = json.data?.url || json.data?.image?.url;
  if (!url) {
    throw new Error("ImgBB response did not include an image URL.");
  }
  return { url, data: json.data };
}

function guessMime(filename) {
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "image/png";
}

function exitWithError(message) {
  console.error(message);
  process.exit(1);
}

function printHelp() {
  console.log(`imgbb-upload — dependency-free ImgBB uploader (prints direct image URL)

Usage:
  node scripts/imgbb-upload.mjs <file> [--key <apiKey>] [--expiration <seconds>] [--json]
  imgbb-upload <file> ...

Environment:
  IMGBB_API_KEY   Optional; overrides the built-in default key if set

Options:
  --key <apiKey>        ImgBB key (default: built-in encrypted key)
  --expiration <sec>    Auto-delete after 60–15552000 seconds (ImgBB)
  --json                Print full API data object instead of one URL per line

Examples:
  node scripts/imgbb-upload.mjs ./photo.png
  node scripts/imgbb-upload.mjs ./a.png ./b.png --key YOUR_KEY
`);
}

function parseCli(argv) {
  /** @type {string|undefined} */
  let key = process.env.IMGBB_API_KEY;
  /** @type {string|undefined} */
  let expiration;
  let json = false;
  const files = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--help" || a === "-h") return { help: true };
    if (a === "--json") {
      json = true;
      continue;
    }
    if (a === "--key" || a === "-k") {
      key = argv[i + 1];
      i += 1;
      continue;
    }
    if (a.startsWith("--key=")) {
      key = a.slice("--key=".length);
      continue;
    }
    if (a === "--expiration") {
      expiration = argv[i + 1];
      i += 1;
      continue;
    }
    if (a.startsWith("--expiration=")) {
      expiration = a.slice("--expiration=".length);
      continue;
    }
    if (a.startsWith("-")) {
      exitWithError(`Unknown option: ${a}`);
    }
    files.push(a);
  }
  return { key, expiration, json, files };
}

async function main() {
  const parsed = parseCli(process.argv.slice(2));
  if (parsed.help) {
    printHelp();
    return;
  }
  if (!parsed.files.length) {
    printHelp();
    exitWithError("Pass at least one image file.");
  }
  let apiKey;
  try {
    apiKey = resolveImgbbApiKey(parsed.key);
  } catch (e) {
    exitWithError(e instanceof Error ? e.message : String(e));
  }
  const results = [];
  for (const file of parsed.files) {
    const { url, data } = await uploadFileToImgbb({
      apiKey,
      filePath: file,
      expiration: parsed.expiration,
    });
    results.push({ url, data });
  }
  if (parsed.json) {
    console.log(JSON.stringify(results.length === 1 ? results[0].data : results.map((r) => r.data), null, 2));
  } else {
    for (const r of results) {
      console.log(r.url);
    }
  }
}

function isMainModule() {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  try {
    return fileURLToPath(import.meta.url) === path.resolve(argv1);
  } catch {
    return false;
  }
}

if (isMainModule()) {
  main().catch((err) => exitWithError(err.message || String(err)));
}

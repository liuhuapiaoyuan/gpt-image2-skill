#!/usr/bin/env node
/**
 * Upload a local image to ImgBB (API v1) and print the direct image URL.
 * @see https://api.imgbb.com/
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const IMGBB_UPLOAD = "https://api.imgbb.com/1/upload";

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
  IMGBB_API_KEY   ImgBB API key if --key is omitted

Options:
  --key <apiKey>        Override IMGBB_API_KEY
  --expiration <sec>    Auto-delete after 60–15552000 seconds (ImgBB)
  --json                Print full API data object instead of one URL per line

Examples:
  IMGBB_API_KEY=xxx node scripts/imgbb-upload.mjs ./photo.png
  node scripts/imgbb-upload.mjs ./a.png ./b.png --key YOUR_KEY
`);
}

function parseCli(argv) {
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
  if (!parsed.key || String(parsed.key).trim() === "") {
    exitWithError("Missing ImgBB API key. Set IMGBB_API_KEY or pass --key.");
  }
  const results = [];
  for (const file of parsed.files) {
    const { url, data } = await uploadFileToImgbb({
      apiKey: parsed.key,
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

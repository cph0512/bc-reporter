// src/services/dataDir.js
// Resolve the writable data directory for JSON file storage.
//
// Priority:
//   1. DATA_DIR env var (Railway volume mount, e.g. /data)
//   2. VERCEL → /tmp
//   3. Fallback → config/ in project root (local dev)

const fs = require('fs');
const path = require('path');

const CONFIG_DIR = path.join(__dirname, '../../config');

function getDataDir() {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  if (process.env.VERCEL) return '/tmp';
  return CONFIG_DIR;
}

const DATA_DIR = getDataDir();

// Ensure DATA_DIR exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

/**
 * Resolve a data file path.
 * If the file doesn't exist in DATA_DIR yet, seed it from config/.
 */
function resolveDataFile(filename) {
  const target = path.join(DATA_DIR, filename);
  const source = path.join(CONFIG_DIR, filename);

  // Seed from config/ on first run (cold start / new volume)
  if (DATA_DIR !== CONFIG_DIR && !fs.existsSync(target) && fs.existsSync(source)) {
    fs.copyFileSync(source, target);
    console.log(`[dataDir] Seeded ${filename} from config/ to ${DATA_DIR}`);
  }

  return target;
}

module.exports = { DATA_DIR, CONFIG_DIR, resolveDataFile };

// ─── Shared state between litematic.html and viewer ──────────────────────────

const STORAGE_KEY_FILE   = 'lmc_file';    // base64 of raw .litematic bytes
const STORAGE_KEY_NAME   = 'lmc_name';    // filename
const STORAGE_KEY_REPLS  = 'lmc_repls';   // JSON replacements map {from: to, ...}

// Save file bytes to localStorage (as base64)
function sharedSaveFile(arrayBuffer, fileName) {
  try {
    const bytes = new Uint8Array(arrayBuffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    const b64 = btoa(binary);
    localStorage.setItem(STORAGE_KEY_FILE, b64);
    localStorage.setItem(STORAGE_KEY_NAME, fileName);
    localStorage.setItem(STORAGE_KEY_REPLS, JSON.stringify({}));
    console.log('Shared: file saved', fileName, bytes.length, 'bytes');
  } catch(e) {
    console.warn('sharedSaveFile failed (maybe too large):', e.message);
  }
}

// Load file bytes from localStorage -> ArrayBuffer
function sharedLoadFile() {
  try {
    const b64 = localStorage.getItem(STORAGE_KEY_FILE);
    const name = localStorage.getItem(STORAGE_KEY_NAME) || 'unknown.litematic';
    if (!b64) return null;
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return { buffer: bytes.buffer, name };
  } catch(e) {
    console.warn('sharedLoadFile failed:', e.message);
    return null;
  }
}

// Save replacements map
function sharedSaveReplacements(replMap) {
  try {
    localStorage.setItem(STORAGE_KEY_REPLS, JSON.stringify(replMap));
    // Trigger storage event for other tabs
    localStorage.setItem(STORAGE_KEY_REPLS + '_ts', Date.now().toString());
  } catch(e) {}
}

// Load replacements map
function sharedLoadReplacements() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_REPLS);
    return raw ? JSON.parse(raw) : {};
  } catch(e) { return {}; }
}

// Listen for replacement changes from other tabs
function sharedOnReplacementsChange(callback) {
  window.addEventListener('storage', e => {
    if (e.key === STORAGE_KEY_REPLS + '_ts') {
      callback(sharedLoadReplacements());
    }
  });
}

// Check if a shared file exists
function sharedHasFile() {
  return !!localStorage.getItem(STORAGE_KEY_FILE);
}

function sharedGetName() {
  return localStorage.getItem(STORAGE_KEY_NAME) || '';
}

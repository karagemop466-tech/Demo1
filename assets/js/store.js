/* Browser-local storage.
 *
 * - Review decisions for suggestions and open questions (localStorage)
 * - A personal trade journal (localStorage)
 * - Demo API credentials (sessionStorage only — cleared when the tab closes,
 *   never written to the repo, never sent anywhere except Kalshi)
 */

const REVIEW_KEY = 'kalshidemo.review.v1';
const JOURNAL_KEY = 'kalshidemo.journal.v1';
const CREDS_KEY = 'kalshidemo.creds.v1';

function read(store, key, fallback) {
  try {
    const raw = store.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(store, key, value) {
  try {
    store.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable (private mode) — the page still works, without memory */
  }
}

/* ---------- review decisions ---------- */

export function getReviews() {
  return read(localStorage, REVIEW_KEY, {});
}

export function setReview(id, value) {
  const all = getReviews();
  all[id] = { value, at: new Date().toISOString() };
  write(localStorage, REVIEW_KEY, all);
  return all;
}

/* ---------- trade journal ---------- */

export function getJournal() {
  return read(localStorage, JOURNAL_KEY, []);
}

export function addJournalEntry(entry) {
  const all = getJournal();
  all.unshift({ id: `j-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`, at: new Date().toISOString(), ...entry });
  write(localStorage, JOURNAL_KEY, all.slice(0, 500));
  return all;
}

export function clearJournal() {
  write(localStorage, JOURNAL_KEY, []);
  return [];
}

/* ---------- demo credentials (session only) ---------- */

export function getCredentials() {
  return read(sessionStorage, CREDS_KEY, null);
}

export function setCredentials({ keyId, privateKey }) {
  const value = { keyId: keyId || '', privateKey: privateKey || '' };
  write(sessionStorage, CREDS_KEY, value);
  return value;
}

export function clearCredentials() {
  try {
    sessionStorage.removeItem(CREDS_KEY);
  } catch {
    /* ignore */
  }
}

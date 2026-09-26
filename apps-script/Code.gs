/**
 * Sight Words — Google Apps Script backend
 * The spreadsheet is the only database. Tabs:
 *   _Students  one row per student (settings + mastery goals)
 *   _Lists     custom word lists (built-in Dolch/Fry/Edmark-style lists live in the app)
 *   <ID>       one tab per student, one row per scored word
 *
 * Script properties (Project Settings → Script properties):
 *   CLASS_KEY     shared key for para tablets (read class, log sessions)
 *   ADMIN_EMAILS  comma-separated Google accounts allowed admin actions
 *   CLIENT_ID     OAuth web client ID used by the app's Google sign-in
 */

const STUDENT_HEADERS = ['Student ID', 'List ID', 'Words per session', 'Review words', 'Goals (JSON)', 'Created'];
const LIST_HEADERS = ['List ID', 'Name', 'Words (comma-separated)', 'Updated'];
const SESSION_HEADERS = ['Timestamp', 'Session ID', 'Paraprofessional', 'Activity', 'Word', 'Result', 'Attempt', 'Prompted'];
const RESERVED = ['_Students', '_Lists'];

function setup() {
  const ss = SpreadsheetApp.getActive();
  ensureSheet_(ss, '_Students', STUDENT_HEADERS);
  ensureSheet_(ss, '_Lists', LIST_HEADERS);
  const p = PropertiesService.getScriptProperties();
  if (!p.getProperty('CLASS_KEY')) p.setProperty('CLASS_KEY', Utilities.getUuid().slice(0, 8));
  Logger.log('Class key: ' + p.getProperty('CLASS_KEY'));
}

function doGet() {
  return json_({ ok: true, data: { service: 'sight-words', time: new Date().toISOString() } });
}

function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents || '{}');
    const handler = ROUTES[req.action];
    if (!handler) throw new Error('Unknown action: ' + req.action);
    if (handler.admin) req.admin = requireAdmin_(req.idToken);
    else requireClassKey_(req);
    return json_({ ok: true, data: handler.fn(req) });
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  }
}

const ROUTES = {
  bootstrap:     { fn: bootstrap_ },
  logSession:    { fn: logSession_ },
  whoami:        { admin: true, fn: r => ({ email: r.admin }) },
  addStudent:    { admin: true, fn: addStudent_ },
  updateStudent: { admin: true, fn: updateStudent_ },
  deleteStudent: { admin: true, fn: deleteStudent_ },
  saveList:      { admin: true, fn: saveList_ },
  deleteList:    { admin: true, fn: deleteList_ }
};

/* ---------- auth ---------- */
function requireClassKey_(req) {
  const key = PropertiesService.getScriptProperties().getProperty('CLASS_KEY');
  if (req.idToken) { try { requireAdmin_(req.idToken); return; } catch (e) {} }
  if (!key || req.classKey !== key) throw new Error('Invalid class key');
}

function requireAdmin_(idToken) {
  if (!idToken) throw new Error('Teacher sign-in required');
  const cache = CacheService.getScriptCache();
  const ck = 'tok_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, idToken));
  const hit = cache.get(ck);
  if (hit) return hit;
  const res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken), { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('Sign-in expired, please sign in again');
  const info = JSON.parse(res.getContentText());
  const props = PropertiesService.getScriptProperties();
  const admins = (props.getProperty('ADMIN_EMAILS') || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
  const email = String(info.email || '').toLowerCase();
  if (info.aud !== props.getProperty('CLIENT_ID')) throw new Error('Token was issued for a different app');
  if (String(info.email_verified) !== 'true' || admins.indexOf(email) < 0) throw new Error(email + ' is not an admin');
  cache.put(ck, email, 300);
  return email;
}

/* ---------- reads ---------- */
function bootstrap_() {
  const ss = SpreadsheetApp.getActive();
  const students = readStudents_(ss);
  const rows = {};
  students.forEach(s => { rows[s.id] = readSessions_(ss.getSheetByName(s.id)); });
  return { students: students, lists: readLists_(ss), rows: rows };
}

function readStudents_(ss) {
  const sh = ensureSheet_(ss, '_Students', STUDENT_HEADERS);
  return values_(sh).filter(r => r[0]).map(r => ({
    id: String(r[0]), list: String(r[1]), perSession: Number(r[2]) || 8, review: Number(r[3]) || 0,
    goals: parse_(r[4]), created: r[5] instanceof Date ? r[5].toISOString() : String(r[5])
  }));
}

function readLists_(ss) {
  const sh = ensureSheet_(ss, '_Lists', LIST_HEADERS);
  return values_(sh).filter(r => r[0]).map(r => ({
    id: String(r[0]), name: String(r[1]), group: 'Custom', builtin: false,
    words: String(r[2]).split(',').map(w => w.trim()).filter(Boolean)
  }));
}

function readSessions_(sh) {
  if (!sh) return [];
  return values_(sh).filter(r => r[0] && r[4]).map(r => ({
    ts: r[0] instanceof Date ? r[0].toISOString() : new Date(r[0]).toISOString(),
    sid: String(r[1]), para: String(r[2]), activity: String(r[3]), word: String(r[4]),
    correct: String(r[5]).toLowerCase() === 'correct', attempt: Number(r[6]) || 1,
    prompted: String(r[7]).toLowerCase() === 'yes'
  }));
}

/* ---------- writes ---------- */
function logSession_(req) {
  const ss = SpreadsheetApp.getActive();
  const id = cleanId_(req.id);
  const sh = ss.getSheetByName(id);
  if (!sh) throw new Error('No tab for ' + id);
  const rows = (req.rows || []).map(r => [
    new Date(r.ts), String(r.sid), String(r.para).slice(0, 60), String(r.activity), String(r.word),
    r.correct ? 'correct' : 'incorrect', Number(r.attempt) || 1, r.prompted ? 'yes' : 'no'
  ]);
  if (!rows.length) return { written: 0 };
  return withLock_(() => {
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, SESSION_HEADERS.length).setValues(rows);
    return { written: rows.length };
  });
}

function addStudent_(req) {
  const ss = SpreadsheetApp.getActive();
  const s = req.student, id = cleanId_(s.id);
  return withLock_(() => {
    if (ss.getSheetByName(id)) throw new Error(id + ' already exists');
    ensureSheet_(ss, id, SESSION_HEADERS);
    ensureSheet_(ss, '_Students', STUDENT_HEADERS).appendRow([id, s.list, s.perSession, s.review, JSON.stringify(s.goals || {}), new Date()]);
    return { id: id };
  });
}

function updateStudent_(req) {
  const ss = SpreadsheetApp.getActive();
  const s = req.student, id = cleanId_(s.id);
  return withLock_(() => {
    const sh = ensureSheet_(ss, '_Students', STUDENT_HEADERS);
    const row = findRow_(sh, id);
    if (!row) throw new Error('No student ' + id);
    sh.getRange(row, 2, 1, 4).setValues([[s.list, s.perSession, s.review, JSON.stringify(s.goals || {})]]);
    return { id: id };
  });
}

function deleteStudent_(req) {
  const ss = SpreadsheetApp.getActive();
  const id = cleanId_(req.id);
  return withLock_(() => {
    const sh = ensureSheet_(ss, '_Students', STUDENT_HEADERS);
    const row = findRow_(sh, id);
    if (row) sh.deleteRow(row);
    const tab = ss.getSheetByName(id);
    if (tab) ss.deleteSheet(tab);
    return { id: id, deletedBy: req.admin };
  });
}

function saveList_(req) {
  const ss = SpreadsheetApp.getActive();
  const l = req.list;
  return withLock_(() => {
    const sh = ensureSheet_(ss, '_Lists', LIST_HEADERS);
    const vals = [String(l.id), String(l.name), (l.words || []).join(', '), new Date()];
    const row = findRow_(sh, l.id);
    if (row) sh.getRange(row, 1, 1, vals.length).setValues([vals]); else sh.appendRow(vals);
    return { id: l.id };
  });
}

function deleteList_(req) {
  const ss = SpreadsheetApp.getActive();
  return withLock_(() => {
    const sh = ensureSheet_(ss, '_Lists', LIST_HEADERS);
    const row = findRow_(sh, req.id);
    if (row) sh.deleteRow(row);
    return { id: req.id };
  });
}

/* ---------- helpers ---------- */
function ensureSheet_(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}
function values_(sh) {
  const n = sh.getLastRow() - 1;
  return n > 0 ? sh.getRange(2, 1, n, sh.getLastColumn()).getValues() : [];
}
function findRow_(sh, id) {
  const col = values_(sh).map(r => String(r[0]));
  const i = col.indexOf(String(id));
  return i < 0 ? 0 : i + 2;
}
function cleanId_(id) {
  const s = String(id || '').trim().toUpperCase();
  if (!/^[A-Z0-9-]{2,12}$/.test(s) || RESERVED.indexOf(s) >= 0) throw new Error('Invalid student ID');
  return s;
}
function parse_(v) { try { return JSON.parse(v); } catch (e) { return null; } }
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

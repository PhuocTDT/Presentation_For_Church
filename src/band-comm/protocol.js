// Band Comm — shared protocol helpers (CommonJS, used by main process).
//
// One envelope shape for every message on the wire. No severity / priority:
// every message is treated the same; receivers only distinguish DIRECTION
// (band vs operator). See band-comm-plan.md §4.

const crypto = require('crypto');

const ROLES = ['band', 'leader', 'operator', 'system'];

const MSG_TYPES = [
  'alert',    // a band member tapped one of their buttons / sent free text
  'text',     // operator free text or quick reply
  'ack',      // "Người vận hành đã tiếp nhận" — targeted at the original sender(s)
  'resolve',  // operator closed the issue — broadcast to everyone
  'presence', // connected-clients list changed
  'gallery',  // active chord-sheet set changed (P4)
  'system'    // server notices (channel opened/closed, errors)
];

function newId(prefix = 'm') {
  return `${prefix}-${crypto.randomBytes(6).toString('hex')}`;
}

// Strip Vietnamese diacritics + punctuation, lowercase, collapse spaces.
// Two people's differently-typed labels for the same problem collapse to one
// key so the operator board can group them. See band-comm-plan.md §6.
function normalizeDedupKey(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritical marks
    .replace(/[đĐ]/g, 'd')   // đ / Đ have no NFD decomposition
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ') // drop punctuation / emoji
    .replace(/\s+/g, ' ')
    .trim();
}

// Build a wire envelope. `from` = { clientId, name, role }.
function makeEnvelope({ type, from, to = 'all', text = '', buttonId = null, refId = null, meta = null }) {
  const safeType = MSG_TYPES.includes(type) ? type : 'system';
  const body = String(text || '');
  return {
    id: newId('m'),
    ts: Date.now(),
    type: safeType,
    from: from || { clientId: 'server', name: 'Kênh Band', role: 'system' },
    to: to || 'all',
    refId: refId || null,
    buttonId: buttonId || null,
    dedupKey: safeType === 'alert' ? normalizeDedupKey(body) : null,
    text: body,
    meta: meta || {}
  };
}

module.exports = { ROLES, MSG_TYPES, newId, normalizeDedupKey, makeEnvelope };

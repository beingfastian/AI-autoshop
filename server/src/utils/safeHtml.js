// Tagged template for email HTML: every interpolated value is escaped, because names, issues and
// vehicles come from callers and the AI. Nested safeHtml`...` blocks are trusted and not escaped again.
class SafeHtml {
  constructor(value) {
    this.value = value;
  }

  toString() {
    return this.value;
  }
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function escapeHtml(value) {
  if (value instanceof SafeHtml) return value.value;
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (ch) => ESCAPES[ch]);
}

function safeHtml(strings, ...values) {
  let out = strings[0];
  values.forEach((value, i) => {
    out += escapeHtml(value) + strings[i + 1];
  });
  return new SafeHtml(out);
}

module.exports = { safeHtml, escapeHtml, SafeHtml };

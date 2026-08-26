// One comparator for everything Archie sorts.
//
// A bare .sort() sorts by UTF-16 code unit, which puts 'ş' after 'z' — surprising
// for anyone whose directories are not in English. The obvious remedy,
// localeCompare, is the wrong one here: its result depends on the ICU data and
// locale of the machine running it, and this codebase renders files that must be
// byte-identical on every machine or the wiki stops being diffable.
//
// So: deterministic code-point order, stated explicitly rather than left to a
// default nobody chose. Where a human-friendly ordering matters more than a
// reproducible one, sort at display time — not here.
const byCodePoint = (a, b) => (a > b) - (a < b);
module.exports = { byCodePoint };

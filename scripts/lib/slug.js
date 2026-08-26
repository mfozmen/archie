// This decides the filename of .archie/flows/<slug>.json, so its output must not
// drift for ANY input.
//
// The first replace collapses every run of non-alphanumerics into ONE '-', so the
// result can never contain two adjacent dashes: at most one leading and one
// trailing dash survive. That is why the trim is `^-|-$` and not `^-+|-+$` —
// same output for every input, without the quadratic backtracking `-+$` costs on
// a long run of dashes.
function slug(id) {
  return String(id).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
module.exports = { slug };

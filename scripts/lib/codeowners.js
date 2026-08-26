// One reading of a CODEOWNERS line, shared by the two callers that need it.
//
// They disagree about what a line MEANS and that disagreement is deliberate: a
// catch-all `*` owner is not evidence that a directory is anybody's area in
// particular, but it is evidence that the whole repository sits in a team's
// world. Policy belongs to each caller. What must not be written twice is the
// reading itself — comment stripping, whitespace splitting, pattern versus
// owners — because two hand-maintained parsers of one file format drift, and
// the drift shows up as a repo quietly missing from somebody's map.
//
// Trimming is indexOf/split rather than a regex, so nothing here has
// backtracking for a scanner to reason about.
function ownersLine(line) {
  const hash = line.indexOf('#');
  const trimmed = (hash === -1 ? line : line.slice(0, hash)).trim();
  if (!trimmed) return null;
  const [pattern, ...owners] = trimmed.split(/\s+/);
  if (!owners.length) return null;
  return { pattern, owners };
}
module.exports = { ownersLine };

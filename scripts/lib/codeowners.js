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
// A team owner and a person are different kinds of fact, and only one of them
// is ours to repeat. Teams answer "whose area is this"; individuals are
// colleagues' names, which the spec's locked constraint keeps out of anything
// Archie emits. Both callers need the same split, so neither gets to decide it
// differently — and the count travels with it so the omission stays visible.
const TEAM = /^@[^/]+\/.+/;
function splitOwners(owners) {
  const teams = [], individuals = [];
  for (const o of owners || []) {
    if (!o.startsWith('@')) continue;
    (TEAM.test(o) ? teams : individuals).push(o);
  }
  return { teams, individuals };
}

// How to describe an assignment out loud: the teams by name, everyone else as a
// number. Built here rather than at each call site because getting it wrong
// means printing somebody's handle into a page or a proposal.
function describeOwners(owners) {
  const { teams, individuals } = splitOwners(owners);
  const parts = [...teams];
  if (individuals.length) parts.push(`${individuals.length} individual${individuals.length > 1 ? 's' : ''}`);
  return parts.join(' and ');
}

module.exports = { ownersLine, splitOwners, describeOwners };

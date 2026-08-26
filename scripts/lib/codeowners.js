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
// Everything after the pattern on a CODEOWNERS line is an owner, and an owner
// is either a team or a person. A person can be written `@handle` OR as a plain
// email address, and an email identifies someone at least as precisely as a
// handle does — so it counts as an individual rather than being dropped.
// Dropping it understated the count, and left describeOwners with nothing to say
// about a line owned entirely by people written that way.
const TEAM = /^@[^/]+\/.+/;
function splitOwners(owners) {
  const teams = [], individuals = [];
  for (const o of owners || []) (TEAM.test(o) ? teams : individuals).push(o);
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

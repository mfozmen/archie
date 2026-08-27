#!/usr/bin/env node
// The one way a skill writes to .archie/.
//
// Everything here goes through the Task 3 validators, so a malformed record is
// refused at the door rather than rendered later as if it were evidence. Input
// is a FILE PATH, never JSON on the command line: a real model runs to hundreds
// of entries, and a single apostrophe in a route label or a claim ("it's
// handled") would break a shell-quoted argument long before node saw it.
const fs = require('node:fs');
const M = require('./lib/model');
const { runMain, paths } = require('./lib/cli');

const USAGE = `usage: store.js <root> <what> <file.json> [--workspace <dir>] [--store <dir>]
  --workspace <dir> the workspace this repo belongs to; its store goes under it
  --store <dir>     the store directory outright; defaults to <root>/.archie
  recipe            validate and write recipe.json into the store
  config            write config.json into the store
  model             validate and write model.json into the store (OVERWRITES — see merge-inventory)
  flow              validate and write flows/<slug>.json into the store
  merge-inventory   merge a discovered entry array into the existing model,
                    preserving what explain proved; prints {added, kept, disappeared}`;

// Everything a config can hold except `scope`, which is the one setting that is
// one repository's own.
const SET_WIDE = ['workspace', 'handle', 'repos', 'declined', 'language', 'output'];

function main(args) {
  const { store, workspace, rest } = paths(args);
  const [root, what, file] = rest;
  if (!root || !what || !file) return die(USAGE);

  let data;
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (err) { return die(`${file}: ${err.message}`); }

  try {
    switch (what) {
      case 'recipe': M.saveRecipe(store, data); break;
      case 'config': {
        // --workspace says this config is one repository's, and the only setting
        // a repository owns is the scope of its own sweep. Everything else
        // belongs to the set and is read from the top of the store, so written
        // here it would be validated, stored, reported back as changed, and
        // then read by nothing. Refuse it where the mistake is made rather than
        // leaving someone to notice their setting never took effect.
        const set = SET_WIDE.filter(k => k in data);
        if (workspace && set.length) return die(`${file}: ${set.join(', ')} `
          + `${set.length > 1 ? 'belong' : 'belongs'} to the whole set, not to one repository — `
          + `write ${set.length > 1 ? 'them' : 'it'} with the workspace as the root and no --workspace flag`);
        M.saveConfig(store, data); break;
      }
      case 'model': M.saveModel(store, data); break;
      case 'flow': M.saveFlow(store, data); break;
      case 'merge-inventory': {
        if (!Array.isArray(data)) return die(`${file}: merge-inventory expects an array of entry-point records`);
        const r = M.mergeModel(M.loadModel(store), data);
        M.saveModel(store, r.model);
        console.log(JSON.stringify({ added: r.added, kept: r.kept, disappeared: r.disappeared }, null, 2));
        break;
      }
      default: return die(`unknown target "${what}"\n\n${USAGE}`);
    }
  } catch (err) { return die(`${file}: ${err.message}`); }
  return 0;
}
function die(msg) { console.error(msg); return 1; }

runMain(module, main);
module.exports = { main };

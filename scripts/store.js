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
const { runMain } = require('./lib/cli');

const USAGE = `usage: store.js <root> <what> <file.json>
  recipe            validate and write .archie/recipe.json
  config            write .archie/config.json
  model             validate and write .archie/model.json (OVERWRITES — see merge-inventory)
  flow              validate and write .archie/flows/<slug>.json
  merge-inventory   merge a discovered entry array into the existing model,
                    preserving what explain proved; prints {added, kept, disappeared}`;

function main(args) {
  const [root, what, file] = args;
  if (!root || !what || !file) return die(USAGE);

  let data;
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (err) { return die(`${file}: ${err.message}`); }

  try {
    switch (what) {
      case 'recipe': M.saveRecipe(root, data); break;
      case 'config': M.saveConfig(root, data); break;
      case 'model': M.saveModel(root, data); break;
      case 'flow': M.saveFlow(root, data); break;
      case 'merge-inventory': {
        if (!Array.isArray(data)) return die(`${file}: merge-inventory expects an array of entry-point records`);
        const r = M.mergeModel(M.loadModel(root), data);
        M.saveModel(root, r.model);
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

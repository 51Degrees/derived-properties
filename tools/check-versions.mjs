/* *********************************************************************
 * This Original Work is copyright of 51 Degrees Mobile Experts Limited.
 * Copyright 2026 51 Degrees Mobile Experts Limited, Davidson House,
 * Forbury Square, Reading, Berkshire, United Kingdom RG1 3EU.
 *
 * This Original Work is licensed under the European Union Public Licence
 * (EUPL) v.1.2 and is subject to its terms as set out below.
 *
 * If a copy of the EUPL was not distributed with this file, You can obtain
 * one at https://opensource.org/licenses/EUPL-1.2.
 * ********************************************************************* */

/**
 * Compares every script in `scripts/` against the same script at a base git
 * ref and fails when either of two things is true.
 *
 * 1. The Output, Checks or Rules block changed and Version did not. Those
 *    three blocks are what an implementation reads, so a change to any of
 *    them changes what a customer gets and has to be visible in the version
 *    number.
 * 2. A script was removed or renamed. A shipped script is never deleted
 *    and never renamed, because a customer may be reading the property it
 *    produces. It gains `Deprecated: true` and a `DeprecationNote` and
 *    stays where it is.
 *
 * The three blocks are compared by the value they parse to rather than by
 * their text, so reformatting, a comment change or a reordering of the keys
 * of a mapping does not ask for a version bump.
 *
 * Both rules apply only from version 1.0.0. A script below 1.0.0 is a
 * draft, so it may change its blocks without a version bump and it may be
 * removed outright, which is what the 0.x range is for. A script skipped
 * for that reason is named in a notice rather than skipped silently.
 *
 * Usage: node tools/check-versions.mjs <base git ref> [repository root]
 */

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, basename, extname, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { parse } from './parse.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The blocks an implementation reads, which a change has to be paid for. */
export const VERSIONED_BLOCKS = ['Output', 'Checks', 'Rules'];

/**
 * The scripts in `scripts/`, as the file name, the script name and the
 * text. The version check parses rather than validates, because a script
 * that has a validation fault is already failed by `run-cases.mjs` and the
 * version question is still worth answering.
 */
function listScripts(root) {
  const folder = join(root, 'scripts');
  const scripts = [];
  if (!existsSync(folder)) return scripts;
  for (const file of readdirSync(folder).sort()) {
    if (!/\.(ya?ml|json)$/i.test(file)) continue;
    scripts.push({
      file,
      name: basename(file, extname(file)),
      text: readFileSync(join(folder, file), 'utf8')
    });
  }
  return scripts;
}

/** Reads a key from a mapping without regard to case, as the validator does. */
function get(mapping, name) {
  if (mapping === null || typeof mapping !== 'object') return undefined;
  const lower = name.toLowerCase();
  for (const key of Object.keys(mapping)) {
    if (key.toLowerCase() === lower) return mapping[key];
  }
  return undefined;
}

/**
 * A form of a value that can be compared with `===` on its JSON text. The
 * keys of every mapping are sorted, because a YAML mapping carries no
 * order, whilst the order of a sequence is kept, because the order of Rules
 * decides which rule wins.
 */
function stableForm(value) {
  if (Array.isArray(value)) return value.map(stableForm);
  if (value !== null && typeof value === 'object') {
    const result = {};
    for (const key of Object.keys(value).sort()) {
      result[key] = stableForm(value[key]);
    }
    return result;
  }
  return value === undefined ? null : value;
}

function same(left, right) {
  return JSON.stringify(stableForm(left)) === JSON.stringify(stableForm(right));
}

function versionOf(document) {
  const version = get(document, 'Version');
  return version === undefined || version === null ? '(none)' : String(version);
}

/** The version from which both rules apply. */
export const FIRST_PUBLISHED_VERSION = '1.0.0';

/**
 * Whether a version is a draft, meaning below 1.0.0. A version that cannot
 * be read at all is not treated as a draft, because the exemption has to be
 * claimed by a version that says so rather than fallen into by a script
 * with no readable version.
 */
export function isDraft(version) {
  const match = /^(\d+)\./.exec(String(version));
  return match !== null && Number(match[1]) === 0;
}

/**
 * Compares the working copy against a base ref.
 *
 * @param {string} root the repository root.
 * @param {string} baseRef the base ref, used in the messages.
 * @param {{readBase: function, listBase: function}} sources `readBase(file)`
 *   returns the text of `scripts/<file>` at the base ref, or null where the
 *   file is not there. `listBase()` returns the names of the files in
 *   `scripts/` at the base ref. A test supplies both directly, so no git
 *   repository is needed.
 * @returns {{rows: object[], failures: string[], notices: string[]}}
 */
export function checkVersions(root, baseRef, sources = {}) {
  const readBase = sources.readBase ?? (() => null);
  const listBase = sources.listBase ?? (() => []);
  const report = { rows: [], failures: [], notices: [] };
  const scripts = listScripts(root);

  if (scripts.length === 0) {
    report.notices.push('scripts/ holds no scripts, so no versions were ' +
      'compared');
  }

  for (const script of scripts) {
    let current;
    try {
      current = parse(script.text).document;
    } catch (error) {
      report.failures.push(`scripts/${script.file} cannot be read. ` +
        error.message);
      continue;
    }

    const baseText = readBase(script.file);
    if (baseText === null || baseText === undefined) {
      report.rows.push({
        Script: script.name,
        Base: 'not at the base ref',
        Current: versionOf(current),
        Verdict: 'new'
      });
      continue;
    }

    let base;
    try {
      base = parse(baseText).document;
    } catch (error) {
      report.failures.push(`scripts/${script.file} at ${baseRef} cannot be ` +
        `read. ${error.message}`);
      continue;
    }

    const changed = VERSIONED_BLOCKS.filter(
      block => !same(get(base, block), get(current, block)));
    const baseVersion = versionOf(base);
    const currentVersion = versionOf(current);
    const blocks = `${changed.length === 1 ? 'the block' : 'the blocks'} ` +
      changed.join(', ');
    let verdict = 'unchanged';
    if (changed.length > 0) {
      if (baseVersion !== currentVersion) {
        verdict = 'changed, version bumped';
      } else if (isDraft(currentVersion)) {
        verdict = `changed, draft below ${FIRST_PUBLISHED_VERSION}`;
        report.notices.push(`${script.name} changed ${blocks} and is a ` +
          `draft at ${currentVersion}, so no version bump is required. ` +
          `From ${FIRST_PUBLISHED_VERSION} a change to ` +
          `${VERSIONED_BLOCKS.join(', ')} must come with a change to Version`);
      } else {
        verdict = 'CHANGED, no version bump';
        report.failures.push(`${script.name} changed ${blocks} but Version ` +
          `is still ${currentVersion}. Raise Version, because an ` +
          'implementation reads those blocks and a customer needs the ' +
          'change to be visible in the number');
      }
    }
    report.rows.push({
      Script: script.name,
      Base: baseVersion,
      Current: currentVersion,
      Verdict: verdict
    });
  }

  // A script that was at the base ref and is not here now was removed, and
  // a rename shows up the same way, being a removal beside a new file.
  const here = new Set(scripts.map(script => script.file));
  for (const file of listBase()) {
    if (here.has(file)) continue;
    const name = basename(file, extname(file));
    let baseVersion = '(unknown)';
    const baseText = readBase(file);
    if (baseText !== null && baseText !== undefined) {
      try {
        baseVersion = versionOf(parse(baseText).document);
      } catch {
        // The base file does not parse, so the version stays unknown and
        // the removal is still reported.
      }
    }
    if (isDraft(baseVersion)) {
      report.rows.push({
        Script: name,
        Base: baseVersion,
        Current: 'not in the working copy',
        Verdict: `removed, draft below ${FIRST_PUBLISHED_VERSION}`
      });
      report.notices.push(`scripts/${file} is at ${baseRef} and is not in ` +
        `the working copy. It was a draft at ${baseVersion}, so removing ` +
        `it is allowed. From ${FIRST_PUBLISHED_VERSION} a script is never ` +
        'deleted and never renamed, because a customer may be reading the ' +
        'property it produces');
      continue;
    }
    report.rows.push({
      Script: name,
      Base: baseVersion,
      Current: 'not in the working copy',
      Verdict: 'REMOVED or renamed'
    });
    report.failures.push(`scripts/${file} is at ${baseRef} and is not in ` +
      'the working copy. A shipped script is never deleted and never ' +
      'renamed. Put the file back, set Deprecated to true and add a ' +
      'DeprecationNote saying what to read instead');
  }

  report.rows.sort((left, right) => left.Script.localeCompare(right.Script));
  return report;
}

/** Runs git in the repository root and returns what it printed. */
function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

/** Reads `scripts/<file>` at the base ref, or null where it is not there. */
function gitReadBase(root, baseRef) {
  return file => {
    try {
      return git(root, ['show', `${baseRef}:scripts/${file}`]);
    } catch {
      // git exits non zero when the path is not in the tree at that ref,
      // which is what a new script looks like.
      return null;
    }
  };
}

/** The names of the files in `scripts/` at the base ref. */
function gitListBase(root, baseRef) {
  return () => {
    let output;
    try {
      output = git(root, ['ls-tree', '--name-only', `${baseRef}:scripts`]);
    } catch {
      // There was no scripts folder at the base ref, so nothing can have
      // been removed since.
      return [];
    }
    return output.split('\n')
      .map(line => line.trim())
      .filter(line => /\.(ya?ml|json)$/i.test(line));
  };
}

function main() {
  const baseRef = process.argv[2];
  if (!baseRef) {
    console.error('usage: node tools/check-versions.mjs <base git ref> ' +
      '[repository root]');
    process.exit(2);
  }
  const root = process.argv[3]
    ? resolve(process.argv[3])
    : resolve(HERE, '..');
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    console.error(`'${root}' is not a folder`);
    process.exit(2);
  }
  try {
    git(root, ['rev-parse', '--git-dir']);
  } catch {
    console.error(`'${root}' is not a git repository, so there is nothing ` +
      'to compare against');
    process.exit(2);
  }
  try {
    git(root, ['rev-parse', '--verify', '--quiet', `${baseRef}^{commit}`]);
  } catch {
    console.error(`the base ref '${baseRef}' is not in this repository. ` +
      'Fetch the branch first, for example with ' +
      `git fetch --no-tags origin ${baseRef.replace(/^origin\//, '')}`);
    process.exit(2);
  }

  const report = checkVersions(root, baseRef, {
    readBase: gitReadBase(root, baseRef),
    listBase: gitListBase(root, baseRef)
  });

  if (report.rows.length > 0) {
    console.table(report.rows);
  }
  for (const notice of report.notices) {
    console.log(`notice: ${notice}`);
  }
  for (const failure of report.failures) {
    console.error(`FAIL ${failure}`);
  }
  console.log(`${report.rows.length} ` +
    `${report.rows.length === 1 ? 'script' : 'scripts'} compared against ` +
    `${baseRef}, ${report.failures.length} failed`);
  process.exit(report.failures.length === 0 ? 0 : 1);
}

if (process.argv[1] &&
  resolve(process.argv[1]) === resolve(HERE, 'check-versions.mjs')) {
  main();
}

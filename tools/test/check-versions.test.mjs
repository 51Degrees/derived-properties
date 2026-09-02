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

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { checkVersions } from '../check-versions.mjs';

/**
 * Builds a script, so a test can change one part of a whole file without
 * repeating the rest of the file.
 */
function script(parts = {}) {
  const version = parts.version ?? '1.0.0';
  const comment = parts.comment ?? '# An example script.';
  const description = parts.description ?? 'An example.';
  const check = parts.check ??
    '  NotCrawler: { Property: device.IsCrawler, Eq: false }';
  const rules = parts.rules ?? [
    '  - When: { Check: NotCrawler }',
    "    Then: 'High'",
    "  - Else: 'Low'"
  ].join('\n');
  const extra = parts.extra ?? '';
  return [
    comment,
    'Format: 1',
    `Name: ${parts.name ?? 'Example'}`,
    `Version: ${version}`,
    extra,
    'Output:',
    `  Name: ${parts.name ?? 'Example'}`,
    `  Description: ${description}`,
    '  ValueType: string',
    '  IsList: false',
    'Checks:',
    check,
    'Rules:',
    rules
  ].filter(line => line !== '').join('\n') + '\n';
}

/** Writes the given files into a new folder and returns the folder. */
function root(files, t) {
  const folder = mkdtempSync(join(tmpdir(), 'derived-versions-'));
  mkdirSync(join(folder, 'scripts'));
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(join(folder, 'scripts', name), text, 'utf8');
  }
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  return folder;
}

/** A base ref built from a plain object of file name to text. */
function base(files) {
  return {
    readBase: name => Object.hasOwn(files, name) ? files[name] : null,
    listBase: () => Object.keys(files)
  };
}

test('a script that has not changed passes', t => {
  const text = script();
  const folder = root({ 'Example.yaml': text }, t);
  const report = checkVersions(folder, 'origin/main',
    base({ 'Example.yaml': text }));
  assert.deepEqual(report.failures, []);
  assert.equal(report.rows[0].Verdict, 'unchanged');
  assert.equal(report.rows[0].Base, '1.0.0');
  assert.equal(report.rows[0].Current, '1.0.0');
});

test('a comment change on its own does not need a version bump', t => {
  const folder = root({
    'Example.yaml': script({ comment: '# The comment wording moved on.' })
  }, t);
  const report = checkVersions(folder, 'origin/main',
    base({ 'Example.yaml': script() }));
  assert.deepEqual(report.failures, []);
  assert.equal(report.rows[0].Verdict, 'unchanged');
});

test('reordering the keys of a block does not need a version bump', t => {
  const reordered = script().replace(
    '  NotCrawler: { Property: device.IsCrawler, Eq: false }',
    '  NotCrawler: { Eq: false, Property: device.IsCrawler }');
  const folder = root({ 'Example.yaml': reordered }, t);
  const report = checkVersions(folder, 'origin/main',
    base({ 'Example.yaml': script() }));
  assert.deepEqual(report.failures, []);
  assert.equal(report.rows[0].Verdict, 'unchanged');
});

test('a changed Rules block without a version change fails and names Rules',
  t => {
    const folder = root({
      'Example.yaml': script({ rules: "  - Else: 'Medium'" })
    }, t);
    const report = checkVersions(folder, 'origin/main',
      base({ 'Example.yaml': script() }));
    assert.equal(report.failures.length, 1);
    assert.match(report.failures[0], /Example/);
    assert.match(report.failures[0], /Rules/);
    assert.match(report.failures[0], /Version/);
    assert.doesNotMatch(report.failures[0], /Output/);
    assert.equal(report.rows[0].Verdict, 'CHANGED, no version bump');
  });

test('a changed Output and Checks names both blocks', t => {
  const folder = root({
    'Example.yaml': script({
      description: 'A different description.',
      check: '  NotCrawler: { Property: device.IsCrawler, Ne: true }'
    })
  }, t);
  const report = checkVersions(folder, 'origin/main',
    base({ 'Example.yaml': script() }));
  assert.equal(report.failures.length, 1);
  assert.match(report.failures[0], /Output, Checks/);
  assert.doesNotMatch(report.failures[0], /Rules/);
});

test('a changed block with a version bump passes', t => {
  const folder = root({
    'Example.yaml': script({ version: '1.1.0', rules: "  - Else: 'Medium'" })
  }, t);
  const report = checkVersions(folder, 'origin/main',
    base({ 'Example.yaml': script() }));
  assert.deepEqual(report.failures, []);
  assert.equal(report.rows[0].Verdict, 'changed, version bumped');
  assert.equal(report.rows[0].Base, '1.0.0');
  assert.equal(report.rows[0].Current, '1.1.0');
});

test('a change outside the three blocks does not need a version bump', t => {
  const folder = root({
    'Example.yaml': script({
      extra: 'Deprecated: true\nDeprecationNote: Replaced by Example2.'
    })
  }, t);
  const report = checkVersions(folder, 'origin/main',
    base({ 'Example.yaml': script() }));
  assert.deepEqual(report.failures, []);
  assert.equal(report.rows[0].Verdict, 'unchanged');
});

test('a script that is not at the base ref is new and passes', t => {
  const folder = root({ 'Example.yaml': script() }, t);
  const report = checkVersions(folder, 'origin/main', base({}));
  assert.deepEqual(report.failures, []);
  assert.equal(report.rows[0].Verdict, 'new');
  assert.equal(report.rows[0].Base, 'not at the base ref');
});

test('a script removed since the base ref fails and asks for Deprecated', t => {
  const folder = root({ 'Example.yaml': script() }, t);
  const report = checkVersions(folder, 'origin/main', base({
    'Example.yaml': script(),
    'Gone.yaml': script({ name: 'Gone' })
  }));
  assert.equal(report.failures.length, 1);
  assert.match(report.failures[0], /Gone/);
  assert.match(report.failures[0], /Deprecated/);
  assert.match(report.failures[0], /DeprecationNote/);
  const row = report.rows.find(r => r.Script === 'Gone');
  assert.equal(row.Verdict, 'REMOVED or renamed');
  assert.equal(row.Current, 'not in the working copy');
});

// ---------------------------------------------------------------------
// Both rules apply only from 1.0.0. A script below 1.0.0 is a draft.
// ---------------------------------------------------------------------

test('a changed block on a draft below 1.0.0 is a notice, not a failure',
  t => {
    const folder = root({
      'Example.yaml': script({ version: '0.1.0', rules: "  - Else: 'Medium'" })
    }, t);
    const report = checkVersions(folder, 'origin/main',
      base({ 'Example.yaml': script({ version: '0.1.0' }) }));
    assert.deepEqual(report.failures, []);
    assert.equal(report.notices.length, 1);
    assert.match(report.notices[0], /Example changed the block Rules/);
    assert.match(report.notices[0], /draft at 0\.1\.0/);
    assert.match(report.notices[0], /From 1\.0\.0/);
    assert.equal(report.rows[0].Verdict, 'changed, draft below 1.0.0');
  });

test('a draft removed since the base ref is a notice, not a failure', t => {
  const folder = root({ 'Example.yaml': script() }, t);
  const report = checkVersions(folder, 'origin/main', base({
    'Example.yaml': script(),
    'Draft.yaml': script({ name: 'Draft', version: '0.1.0' })
  }));
  assert.deepEqual(report.failures, []);
  assert.equal(report.notices.length, 1);
  assert.match(report.notices[0], /Draft\.yaml/);
  assert.match(report.notices[0], /draft at 0\.1\.0/);
  assert.match(report.notices[0], /From 1\.0\.0/);
  const row = report.rows.find(r => r.Script === 'Draft');
  assert.equal(row.Verdict, 'removed, draft below 1.0.0');
  assert.equal(row.Current, 'not in the working copy');
});

test('the exemption stops at 1.0.0, so a changed block there still fails',
  t => {
    const folder = root({
      'Example.yaml': script({ version: '1.0.0', rules: "  - Else: 'Medium'" })
    }, t);
    const report = checkVersions(folder, 'origin/main',
      base({ 'Example.yaml': script({ version: '1.0.0' }) }));
    assert.equal(report.failures.length, 1);
    assert.deepEqual(report.notices, []);
    assert.equal(report.rows[0].Verdict, 'CHANGED, no version bump');
  });

test('a draft that changed a block and bumped its version is unremarkable',
  t => {
    const folder = root({
      'Example.yaml': script({ version: '0.2.0', rules: "  - Else: 'Medium'" })
    }, t);
    const report = checkVersions(folder, 'origin/main',
      base({ 'Example.yaml': script({ version: '0.1.0' }) }));
    assert.deepEqual(report.failures, []);
    assert.deepEqual(report.notices, []);
    assert.equal(report.rows[0].Verdict, 'changed, version bumped');
  });

test('a version that cannot be read does not claim the draft exemption', t => {
  // The exemption is claimed by a version that says 0.x, rather than
  // fallen into by a script whose version cannot be read at all.
  const folder = root({
    'Example.yaml': script().replace('Version: 1.0.0\n', '')
  }, t);
  const report = checkVersions(folder, 'origin/main', base({
    'Example.yaml': script().replace('Version: 1.0.0\n', ''),
    'Gone.yaml': script({ name: 'Gone' }).replace('Version: 1.0.0\n', '')
  }));
  assert.equal(report.failures.length, 1);
  assert.match(report.failures[0], /Gone/);
  assert.equal(report.rows.find(r => r.Script === 'Gone').Verdict,
    'REMOVED or renamed');
});

test('a renamed script is reported as a removal', t => {
  const folder = root({ 'Renamed.yaml': script({ name: 'Renamed' }) }, t);
  const report = checkVersions(folder, 'origin/main', base({
    'Example.yaml': script()
  }));
  assert.equal(report.failures.length, 1);
  assert.match(report.failures[0], /Example/);
  assert.equal(report.rows.find(r => r.Script === 'Renamed').Verdict, 'new');
});

test('every script is reported, not only the ones that failed', t => {
  const folder = root({
    'Example.yaml': script(),
    'Second.yaml': script({ name: 'Second', rules: "  - Else: 'Medium'" })
  }, t);
  const report = checkVersions(folder, 'origin/main', base({
    'Example.yaml': script(),
    'Second.yaml': script({ name: 'Second' })
  }));
  assert.equal(report.rows.length, 2);
  assert.deepEqual(report.rows.map(r => r.Script), ['Example', 'Second']);
  assert.equal(report.failures.length, 1);
});

test('a script that cannot be parsed is a failure rather than a throw', t => {
  const folder = root({ 'Example.yaml': 'Name: [unclosed\n' }, t);
  const report = checkVersions(folder, 'origin/main',
    base({ 'Example.yaml': script() }));
  assert.equal(report.failures.length, 1);
  assert.match(report.failures[0], /cannot be read/);
});

test('an empty scripts folder is a notice rather than a failure', t => {
  const folder = root({}, t);
  const report = checkVersions(folder, 'origin/main', base({}));
  assert.deepEqual(report.failures, []);
  assert.equal(report.notices.length, 1);
  assert.match(report.notices[0], /no scripts/);
});

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
 * Tests canonical/, the printed form of every script in scripts/.
 *
 * The folder exists for the languages that embed this repository as a
 * submodule. Each of them prints a script into the canonical form and has
 * to agree with tools/canonical.mjs character for character, and the only
 * way to check that from the other side of the boundary is to read the
 * text this repository printed. Shipping it in the submodule means a
 * script and the print of it move in one commit, so a consumer that bumps
 * the submodule gets both and never sees them disagree.
 *
 * These tests are what stop the folder going stale on this side.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadScripts } from '../run-cases.mjs';
import { canonical } from '../canonical.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const CANONICAL = join(ROOT, 'canonical');

const scripts = loadScripts(ROOT);

test('there is a script to print', () => {
  assert.ok(
    scripts.length > 0,
    'no scripts were loaded, so the rest of this file would pass by ' +
    'saying nothing');
});

for (const script of scripts) {
  test(`canonical/${script.name}.json is what the tools print`, () => {
    const path = join(CANONICAL, `${script.name}.json`);
    assert.ok(
      existsSync(path),
      `${script.name} has no printed form. Regenerate canonical/ as ` +
      'docs/testing.md describes.');
    assert.equal(
      readFileSync(path, 'utf8'),
      `${canonical(script.model)}\n`,
      `${script.name} has changed since canonical/${script.name}.json ` +
      'was written. Regenerate canonical/ as docs/testing.md describes.');
  });
}

test('canonical/ holds nothing that is not a script', () => {
  const printed = readdirSync(CANONICAL)
    .filter(f => extname(f) === '.json')
    .map(f => basename(f, '.json'))
    .sort();
  assert.deepEqual(
    printed,
    scripts.map(s => s.name).sort(),
    'canonical/ and scripts/ name different things. A script that was ' +
    'renamed or removed leaves its print behind, and a consumer reading ' +
    'the leftover would be checking against a script that no longer ' +
    'exists.');
});

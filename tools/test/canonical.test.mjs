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
import { validateText } from '../validate.mjs';
import { canonical } from '../canonical.mjs';

const YAML = `
Format: 1
Name: Example
Version: 1.0.0
Output:
  Name: Example
  Description: An example property.
  ValueType: string
  IsList: false
  DefaultValue: Unknown
  Category: General
  Values:
    - { Name: High, Description: High. }
    - { Name: Unknown, Description: Unknown. }
Checks:
  NotCrawler: { Property: device.IsCrawler, Eq: false }
  Fresh:
    All:
      - { Property: device.Year, Gt: 0 }
      - { Not: { Property: device.Year, Gt: 3000 } }
Rules:
  - When: { All: [ { Check: NotCrawler }, { Passed: Checks, Ge: 1 } ] }
    Then: High
  - Else: Unknown
`;

const JSON_TEXT = JSON.stringify({
  Format: 1,
  Name: 'Example',
  Version: '1.0.0',
  Output: {
    Name: 'Example',
    Description: 'An example property.',
    ValueType: 'string',
    IsList: false,
    DefaultValue: 'Unknown',
    Category: 'General',
    Values: [
      { Name: 'High', Description: 'High.' },
      { Name: 'Unknown', Description: 'Unknown.' }
    ]
  },
  Checks: {
    NotCrawler: { Property: 'device.IsCrawler', Eq: false },
    Fresh: {
      All: [
        { Property: 'device.Year', Gt: 0 },
        { Not: { Property: 'device.Year', Gt: 3000 } }
      ]
    }
  },
  Rules: [
    { When: { All: [{ Check: 'NotCrawler' }, { Passed: 'Checks', Ge: 1 }] },
      Then: 'High' },
    { Else: 'Unknown' }
  ]
});

function modelOf(text) {
  const { model, faults } = validateText(text, { name: 'Example' });
  assert.deepEqual(faults, [], JSON.stringify(faults, null, 2));
  return model;
}

test('YAML and the JSON that mirrors it print the same canonical JSON', () => {
  assert.equal(canonical(modelOf(YAML)), canonical(modelOf(JSON_TEXT)));
});

test('the canonical form prints two space indent and PascalCase keys', () => {
  const text = canonical(modelOf(YAML));
  assert.ok(text.startsWith('{\n  "Format": 1,\n  "Name": "Example",'), text);
  assert.ok(text.includes('"Output": {\n    "Name": "Example",'));
});

test('the canonical form carries the inferred type of each source property', () => {
  const printed = JSON.parse(canonical(modelOf(YAML)));
  assert.deepEqual(printed.Properties, {
    'device.IsCrawler': { Type: 'bool' },
    'device.Year': { Type: 'int' }
  });
});

test('the canonical form carries the computed Dependencies', () => {
  const printed = JSON.parse(canonical(modelOf(YAML)));
  assert.deepEqual(printed.Output.Dependencies,
    ['device.IsCrawler', 'device.Year']);
});

test('the canonical form keeps literal types rather than printing them as text', () => {
  const printed = JSON.parse(canonical(modelOf(YAML)));
  assert.equal(printed.Checks.NotCrawler.Eq, false);
  assert.equal(printed.Checks.Fresh.All[0].Gt, 0);
  assert.equal(printed.Rules[0].When.All[1].Ge, 1);
});

test('the canonical form prints Output fields in the reference order', () => {
  const printed = canonical(modelOf(YAML));
  const output = JSON.parse(printed).Output;
  assert.deepEqual(Object.keys(output), ['Name', 'Description', 'ValueType',
    'DefaultValue', 'IsList', 'Category', 'Dependencies', 'Values']);
});

test('a group written as Checks prints as Checks, and a named group as its names', () => {
  const text = YAML.replace('{ Passed: Checks, Ge: 1 }',
    '{ Passed: [NotCrawler], Ge: 1 }');
  const printed = JSON.parse(canonical(modelOf(text)));
  assert.deepEqual(printed.Rules[0].When.All[1].Passed, ['NotCrawler']);
});

test('a deprecated script prints its note', () => {
  const text = YAML.replace('Version: 1.0.0',
    'Version: 1.0.0\nDeprecated: true\nDeprecationNote: Use Example2 instead.');
  const printed = JSON.parse(canonical(modelOf(text)));
  assert.equal(printed.Deprecated, true);
  assert.equal(printed.DeprecationNote, 'Use Example2 instead.');
});

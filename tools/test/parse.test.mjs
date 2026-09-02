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
import { parse, lineOf, ParseError } from '../parse.mjs';

test('parse reads YAML into a plain object', () => {
  const result = parse('Format: 1\nName: Example\n');
  assert.equal(result.format, 'yaml');
  assert.deepEqual(result.document, { Format: 1, Name: 'Example' });
});

test('parse detects JSON from the first non whitespace brace', () => {
  const result = parse('\n\n  {"Format": 1, "Name": "Example"}');
  assert.equal(result.format, 'json');
  assert.deepEqual(result.document, { Format: 1, Name: 'Example' });
});

test('YAML and JSON of the same script give the same document', () => {
  const yaml = parse('Format: 1\nRules:\n  - Else: High\n').document;
  const json = parse('{"Format":1,"Rules":[{"Else":"High"}]}').document;
  assert.deepEqual(yaml, json);
});

test('parse records the line each YAML object node opened on', () => {
  const result = parse([
    'Format: 1',            // line 1
    'Rules:',               // line 2
    '  - When:',            // line 3
    '      Property: a.B',  // line 4
    '      Eq: true',       // line 5
    '    Then: High'        // line 6
  ].join('\n'));
  // A block mapping opens on the line of the key that introduces it, so
  // the When mapping and the rule that holds it both report line 3.
  assert.equal(lineOf(result, result.document.Rules[0].When), 3);
  assert.equal(lineOf(result, result.document.Rules[0]), 3);
  assert.equal(lineOf(result, result.document.Rules), 2);
  assert.equal(lineOf(result, result.document), 1);
});

test('parse gives no line numbers for JSON', () => {
  const result = parse('{"Rules":[{"Else":"High"}]}');
  assert.equal(lineOf(result, result.document.Rules[0]), null);
});

test('unparsable YAML raises a ParseError carrying the line', () => {
  let error = null;
  try {
    parse('Format: 1\nName: [unclosed\n');
  } catch (caught) {
    error = caught;
  }
  assert.ok(error instanceof ParseError);
  assert.equal(typeof error.line, 'number');
  assert.ok(error.message.length > 0);
});

test('unparsable JSON raises a ParseError', () => {
  assert.throws(() => parse('{"Format": }'), ParseError);
});

test('a document that is not a mapping is a ParseError', () => {
  assert.throws(() => parse('- one\n- two\n'), ParseError);
});

test('YAML duplicate keys are rejected', () => {
  assert.throws(() => parse('Name: One\nName: Two\n'), ParseError);
});

test('two keys differing only in case are rejected in YAML', () => {
  // Keys are matched without regard to case, so Name and name are one key
  // written twice and taking either one silently drops half the script.
  let error = null;
  try {
    parse('Format: 1\nName: One\nname: Two\n');
  } catch (caught) {
    error = caught;
  }
  assert.ok(error instanceof ParseError, 'the script should be rejected');
  assert.match(error.message, /differ only in case/);
});

test('two keys differing only in case are rejected in JSON', () => {
  assert.throws(
    () => parse('{"Name": "One", "name": "Two"}'), ParseError);
});

test('two keys differing only in case are rejected inside a nested mapping',
  () => {
    assert.throws(
      () => parse('Rules:\n  - When: { Property: a.B, Eq: true, eq: false }\n'),
      ParseError);
  });

test('two keys differing only in case are rejected inside a list', () => {
  assert.throws(
    () => parse('Output:\n  Values:\n    - { Name: A, name: B }\n'),
    ParseError);
});

test('keys that differ by more than case are kept', () => {
  const result = parse('Name: One\nVersion: 1.0.0\n');
  assert.deepEqual(result.document, { Name: 'One', Version: '1.0.0' });
});

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

/** A script that validates, used as the base for the fault tests. */
const GOOD = `
Format: 1
Name: Example
Version: 1.0.0
Output:
  Name: Example
  Description: An example property.
  ValueType: string
  IsList: false
  DefaultValue: Unknown
  Values:
    - { Name: High, Description: High. }
    - { Name: Low, Description: Low. }
    - { Name: Unknown, Description: Unknown. }
Checks:
  NotCrawler: { Property: device.IsCrawler, Eq: false }
Rules:
  - When: { Check: NotCrawler }
    Then: High
  - Else: Low
`;

/** Replaces one line of the good script, to make one fault at a time. */
function withLine(find, replace) {
  assert.ok(GOOD.includes(find), `the good script must contain "${find}"`);
  return GOOD.replace(find, replace);
}

/** Validates and returns the faults, asserting at least one was found. */
function faultsOf(text, name = 'Example') {
  const result = validateText(text, { name, source: 'test' });
  assert.equal(result.model, null,
    'the script was expected to be rejected but it validated');
  assert.ok(result.faults.length > 0);
  return result.faults;
}

/** Asserts one fault has the path and a message containing the fragment. */
function assertFault(faults, path, fragment) {
  const matching = faults.filter(f => f.path === path);
  assert.ok(matching.length > 0,
    `no fault at path "${path}". Faults were:\n` +
    faults.map(f => `  ${f.path}: ${f.message}`).join('\n'));
  assert.ok(matching.some(f => f.message.includes(fragment)),
    `no fault at "${path}" mentioning "${fragment}". Found:\n` +
    matching.map(f => `  ${f.message}`).join('\n'));
}

test('the good script validates and builds a model', () => {
  const { model, faults } = validateText(GOOD, { name: 'Example' });
  assert.deepEqual(faults, []);
  assert.equal(model.name, 'Example');
  assert.equal(model.version, '1.0.0');
  assert.equal(model.output.ValueType, 'string');
  assert.equal(model.rules.length, 2);
  assert.equal(model.checks.length, 1);
});

test('the validator computes Dependencies when the script omits them', () => {
  const { model } = validateText(GOOD, { name: 'Example' });
  assert.deepEqual(model.output.Dependencies, ['device.IsCrawler']);
});

test('the validator records the inferred type of each source property', () => {
  const { model } = validateText(GOOD, { name: 'Example' });
  assert.deepEqual(model.properties, [
    { key: 'device.iscrawler', name: 'device.IsCrawler', type: 'bool' }
  ]);
});

// ---------------------------------------------------------------------
// One test per fault class in DESIGN.md 4.2.
// ---------------------------------------------------------------------

test('fault: text that does not parse', () => {
  const faults = faultsOf('Name: [unclosed\n');
  assertFault(faults, '', 'not valid YAML');
});

test('fault: Format missing', () => {
  const faults = faultsOf(GOOD.replace('Format: 1\n', ''));
  assertFault(faults, 'Format', "required key 'Format' is missing");
});

test('fault: Format is not 1', () => {
  const faults = faultsOf(withLine('Format: 1', 'Format: 2'));
  assertFault(faults, 'Format', "Format must be 1, found 2");
});

test('fault: an unknown key at the top level', () => {
  const faults = faultsOf(GOOD + 'Inputs:\n  - device.IsCrawler\n');
  assertFault(faults, 'Inputs', "unknown key 'Inputs'");
});

test('fault: an unknown key under Output', () => {
  const faults = faultsOf(withLine(
    '  Description: An example property.',
    '  Description: An example property.\n  Descriptoin: typed twice'));
  assertFault(faults, 'Output.Descriptoin', "unknown key 'Descriptoin'");
});

test('fault: a key of the wrong type', () => {
  const faults = faultsOf(withLine('  IsList: false', '  IsList: nope'));
  assertFault(faults, 'Output.IsList', 'expected a boolean');
});

test('fault: Name does not match the pattern', () => {
  const faults = faultsOf(
    withLine('Name: Example\nVersion', 'Name: 1Example\nVersion'), '1Example');
  assertFault(faults, 'Name', "does not match the pattern");
});

test('fault: Name is not equal to the file name', () => {
  const faults = faultsOf(GOOD, 'SomethingElse');
  assertFault(faults, 'Name',
    "script name 'Example' must equal the file name 'SomethingElse'");
});

test('fault: Output.ValueType outside the format 1 set', () => {
  const faults = faultsOf(withLine(
    '  ValueType: string', '  ValueType: weightedstring'));
  assertFault(faults, 'Output.ValueType', "'weightedstring'");
});

test('fault: Output.IsList is true', () => {
  const faults = faultsOf(withLine('  IsList: false', '  IsList: true'));
  assertFault(faults, 'Output.IsList', 'must be false in format 1');
});

test('fault: an operator that does not exist', () => {
  const faults = faultsOf(withLine(
    '{ Property: device.IsCrawler, Eq: false }',
    '{ Property: device.IsCrawler, Equals: false }'));
  assertFault(faults, 'Checks.NotCrawler', "unknown operator 'Equals'");
});

test('fault: more than one operator in a condition', () => {
  const faults = faultsOf(withLine(
    '{ Property: device.IsCrawler, Eq: false }',
    '{ Property: device.IsCrawler, Eq: false, Ne: true }'));
  assertFault(faults, 'Checks.NotCrawler', 'exactly one operator');
});

test('fault: an operator not allowed on the inferred type', () => {
  const faults = faultsOf(withLine(
    '{ Property: device.IsCrawler, Eq: false }',
    '{ Property: device.BrowserName, Gt: "A" }'));
  assertFault(faults, 'Checks.NotCrawler',
    "operator 'Gt' is not allowed on type string");
});

test('fault: a null literal', () => {
  const faults = faultsOf(withLine(
    '{ Property: device.IsCrawler, Eq: false }',
    '{ Property: device.IsCrawler, Eq: null }'));
  assertFault(faults, 'Checks.NotCrawler.Eq', 'a null literal');
});

test('fault: the same property inferring two types, naming both places', () => {
  const faults = faultsOf(withLine(
    'Rules:\n  - When: { Check: NotCrawler }',
    'Rules:\n  - When: { Property: device.IsCrawler, Eq: 1 }'));
  assertFault(faults, 'Rules[0].When',
    "already inferred as bool at Checks.NotCrawler");
});

test('fault: a Check reference that is not defined', () => {
  const faults = faultsOf(withLine('{ Check: NotCrawler }', '{ Check: NoSuch }'));
  assertFault(faults, 'Rules[0].When.Check', "check 'NoSuch' is not defined");
});

test('fault: a check group naming an unknown check', () => {
  const faults = faultsOf(withLine(
    '  - When: { Check: NotCrawler }',
    '  - When: { Passed: [NotCrawler, NoSuch], Ge: 1 }'));
  assertFault(faults, 'Rules[0].When.Passed',
    "check 'NoSuch' is not defined");
});

test('fault: an aggregate compared against another aggregate', () => {
  // A count is compared against a whole number and against nothing else.
  const faults = faultsOf(withLine(
    '  - When: { Check: NotCrawler }',
    '  - When: { Failed: Checks, Gt: { Passed: Checks } }'));
  assertFault(faults, 'Rules[0].When.Gt',
    'an aggregate is compared with a whole number');
});

test('fault: an aggregate compared against a string', () => {
  const faults = faultsOf(withLine(
    '  - When: { Check: NotCrawler }',
    '  - When: { Failed: Checks, Gt: "one" }'));
  assertFault(faults, 'Rules[0].When.Gt',
    'an aggregate is compared with a whole number');
});

test('fault: Then outside Output.Values', () => {
  const faults = faultsOf(withLine('    Then: High', '    Then: Enormous'));
  assertFault(faults, 'Rules[0].Then', "'Enormous' is not one of the values");
});

test('fault: Then of the wrong type', () => {
  const faults = faultsOf(withLine('    Then: High', '    Then: 7'));
  assertFault(faults, 'Rules[0].Then', 'expected a string');
});

test('fault: DefaultValue outside Output.Values', () => {
  const faults = faultsOf(withLine(
    '  DefaultValue: Unknown', '  DefaultValue: Nothing'));
  assertFault(faults, 'Output.DefaultValue', "'Nothing' is not one of the values");
});

test('fault: Else anywhere but last', () => {
  const faults = faultsOf(withLine(
    '  - When: { Check: NotCrawler }\n    Then: High\n  - Else: Low',
    '  - Else: Low\n  - When: { Check: NotCrawler }\n    Then: High'));
  assertFault(faults, 'Rules[0]', 'Else is only allowed on the last rule');
});

test('fault: a rule with both When and Else', () => {
  const faults = faultsOf(withLine(
    '  - Else: Low', '  - When: { Check: NotCrawler }\n    Else: Low'));
  assertFault(faults, 'Rules[1]', 'has both When and Else');
});

test('fault: the last rule is not an Else', () => {
  const faults = faultsOf(withLine('  - Else: Low', ''));
  assertFault(faults, 'Rules', 'the last rule must be an Else');
});

test('fault: the last rule is not a mapping at all', () => {
  const faults = faultsOf(
    GOOD.slice(0, GOOD.indexOf('Rules:')) + 'Rules:\n  - Low\n');
  assertFault(faults, 'Rules', 'the last rule must be an Else');
  assertFault(faults, 'Rules[0]', 'a rule expected a mapping');
});

test('a Then or an Else is a literal rather than a mapping', () => {
  const faults = faultsOf(withLine(
    '    Then: High', '    Then: { Passed: Checks }'));
  assertFault(faults, 'Rules[0].Then',
    'a rule value is a literal of the output value type');
});

test('fault: Rules missing', () => {
  const faults = faultsOf(GOOD.slice(0, GOOD.indexOf('Rules:')));
  assertFault(faults, 'Rules', "required key 'Rules' is missing");
});

test('fault: Rules is empty', () => {
  const faults = faultsOf(
    GOOD.slice(0, GOOD.indexOf('Rules:')) + 'Rules: []\n');
  assertFault(faults, 'Rules', 'at least one rule');
});

test('fault: a source property that is not elementKey.PropertyName', () => {
  const faults = faultsOf(withLine(
    '{ Property: device.IsCrawler, Eq: false }',
    '{ Property: IsCrawler, Eq: false }'));
  assertFault(faults, 'Checks.NotCrawler.Property', 'elementKey.PropertyName');
});

test('fault: DeprecationNote missing when Deprecated is true', () => {
  const faults = faultsOf(withLine(
    'Version: 1.0.0', 'Version: 1.0.0\nDeprecated: true'));
  assertFault(faults, 'DeprecationNote', 'a deprecated script must say');
});

test('fault: a mixed type list literal', () => {
  const faults = faultsOf(withLine(
    '{ Property: device.IsCrawler, Eq: false }',
    '{ Property: device.BrowserName, In: ["Chrome", 7] }'));
  assertFault(faults, 'Checks.NotCrawler.In', 'every member of a list');
});

test('fault: Version is not a semantic version', () => {
  const faults = faultsOf(withLine('Version: 1.0.0', 'Version: one'));
  assertFault(faults, 'Version', 'semantic version');
});

test('every fault carries a line number for a YAML script', () => {
  const faults = faultsOf(withLine('  IsList: false', '  IsList: true'));
  const fault = faults.find(f => f.path === 'Output.IsList');
  assert.equal(typeof fault.line, 'number');
});

test('the validator collects every fault rather than stopping at the first', () => {
  const faults = faultsOf(
    withLine('Format: 1', 'Format: 3').replace('  IsList: false', '  IsList: true'));
  assert.ok(faults.length >= 2, `expected several faults, got ${faults.length}`);
});

test('faults carry the script name and source', () => {
  const faults = faultsOf(withLine('Format: 1', 'Format: 9'));
  assert.equal(faults[0].script, 'Example');
  assert.equal(faults[0].source, 'test');
});

// ---------------------------------------------------------------------
// Type inference.
// ---------------------------------------------------------------------

test('types are inferred from the literal compared against', () => {
  const text = GOOD.replace(
    '  NotCrawler: { Property: device.IsCrawler, Eq: false }',
    '  NotCrawler: { Property: device.IsCrawler, Eq: false }\n' +
    '  Year:  { Property: device.Year, Gt: 0 }\n' +
    '  Age:   { Property: device.Age, Lt: 2.5 }\n' +
    '  Name:  { Property: device.Name, StartsWith: "Chr" }');
  const { model, faults } = validateText(text, { name: 'Example' });
  assert.deepEqual(faults, []);
  const types = Object.fromEntries(model.properties.map(p => [p.name, p.type]));
  assert.deepEqual(types, {
    'device.IsCrawler': 'bool',
    'device.Year': 'int',
    'device.Age': 'double',
    'device.Name': 'string'
  });
});

test('property names are matched without regard to case', () => {
  const text = GOOD.replace(
    '  NotCrawler: { Property: device.IsCrawler, Eq: false }',
    '  NotCrawler: { Property: device.IsCrawler, Eq: false }\n' +
    '  Again:      { Property: DEVICE.iscrawler, Eq: true }');
  const { model, faults } = validateText(text, { name: 'Example' });
  assert.deepEqual(faults, []);
  assert.equal(model.properties.length, 1);
  assert.equal(model.properties[0].name, 'device.IsCrawler');
});

test('top level keys are matched without regard to case', () => {
  const text = GOOD.replace('Format: 1', 'format: 1')
    .replace('Rules:', 'rules:');
  const { model, faults } = validateText(text, { name: 'Example' });
  assert.deepEqual(faults, []);
  assert.equal(model.format, 1);
});

test('a JSON script and the YAML it mirrors validate to the same model', () => {
  const json = JSON.stringify({
    Format: 1,
    Name: 'Example',
    Version: '1.0.0',
    Output: {
      Name: 'Example',
      Description: 'An example property.',
      ValueType: 'string',
      IsList: false,
      DefaultValue: 'Unknown',
      Values: [
        { Name: 'High', Description: 'High.' },
        { Name: 'Low', Description: 'Low.' },
        { Name: 'Unknown', Description: 'Unknown.' }
      ]
    },
    Checks: { NotCrawler: { Property: 'device.IsCrawler', Eq: false } },
    Rules: [{ When: { Check: 'NotCrawler' }, Then: 'High' }, { Else: 'Low' }]
  });
  const fromJson = validateText(json, { name: 'Example' });
  const fromYaml = validateText(GOOD, { name: 'Example' });
  assert.deepEqual(fromJson.faults, []);
  assert.deepEqual(fromYaml.faults, []);
  assert.deepEqual(fromJson.model.rules, fromYaml.model.rules);
  assert.deepEqual(fromJson.model.checks, fromYaml.model.checks);
  assert.deepEqual(fromJson.model.output, fromYaml.model.output);
});

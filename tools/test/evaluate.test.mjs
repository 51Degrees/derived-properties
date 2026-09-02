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
import { validateText, inferType } from '../validate.mjs';
import { evaluate, convertValue, convertString } from '../evaluate.mjs';

/**
 * Builds a script whose single rule returns "Yes" when the condition is
 * true and "No" otherwise, so a condition can be tested on its own.
 */
function conditionScript(conditionYaml, checks = '') {
  return `
Format: 1
Name: Probe
Version: 1.0.0
Output:
  Name: Probe
  Description: Whether the condition was true.
  ValueType: string
  IsList: false
${checks}
Rules:
  - When: ${conditionYaml}
    Then: Yes it is
  - Else: No it is not
`;
}

/** Runs a condition script and gives "yes", "no" or the raw result. */
function runCondition(conditionYaml, properties, checks) {
  const { model, faults } = validateText(
    conditionScript(conditionYaml, checks), { name: 'Probe' });
  assert.deepEqual(faults, [], JSON.stringify(faults, null, 2));
  const result = evaluate(model, properties);
  if (result.value === 'Yes it is') return 'yes';
  if (result.value === 'No it is not') return 'no';
  return result;
}

// ---------------------------------------------------------------------
// Every operator on every allowed type.
// ---------------------------------------------------------------------

test('Eq and Ne on bool', () => {
  assert.equal(runCondition('{ Property: a.P, Eq: true }', { 'a.P': true }),
    'yes');
  assert.equal(runCondition('{ Property: a.P, Eq: true }', { 'a.P': false }),
    'no');
  assert.equal(runCondition('{ Property: a.P, Ne: true }', { 'a.P': false }),
    'yes');
});

test('Eq and Ne on int and double', () => {
  assert.equal(runCondition('{ Property: a.P, Eq: 8 }', { 'a.P': 8 }), 'yes');
  assert.equal(runCondition('{ Property: a.P, Ne: 8 }', { 'a.P': 9 }), 'yes');
  assert.equal(runCondition('{ Property: a.P, Eq: 1.5 }', { 'a.P': 1.5 }),
    'yes');
});

test('Eq on string compares ordinally and with regard to case', () => {
  assert.equal(runCondition('{ Property: a.P, Eq: "None" }',
    { 'a.P': 'None' }), 'yes');
  assert.equal(runCondition('{ Property: a.P, Eq: "None" }',
    { 'a.P': 'none' }), 'no');
});

test('Gt, Ge, Lt and Le on int', () => {
  assert.equal(runCondition('{ Property: a.P, Gt: 0 }', { 'a.P': 1 }), 'yes');
  assert.equal(runCondition('{ Property: a.P, Gt: 0 }', { 'a.P': 0 }), 'no');
  assert.equal(runCondition('{ Property: a.P, Ge: 8 }', { 'a.P': 8 }), 'yes');
  assert.equal(runCondition('{ Property: a.P, Lt: 2 }', { 'a.P': 1 }), 'yes');
  assert.equal(runCondition('{ Property: a.P, Le: 2 }', { 'a.P': 2 }), 'yes');
});

test('Gt, Ge, Lt and Le on double', () => {
  assert.equal(runCondition('{ Property: a.P, Gt: 0.5 }', { 'a.P': 0.6 }),
    'yes');
  assert.equal(runCondition('{ Property: a.P, Le: 0.5 }', { 'a.P': 0.5 }),
    'yes');
});

test('In and NotIn on string, int and bool', () => {
  assert.equal(runCondition('{ Property: a.P, In: ["A", "B"] }',
    { 'a.P': 'B' }), 'yes');
  assert.equal(runCondition('{ Property: a.P, NotIn: ["A", "B"] }',
    { 'a.P': 'C' }), 'yes');
  assert.equal(runCondition('{ Property: a.P, In: [1, 2, 3] }', { 'a.P': 2 }),
    'yes');
  assert.equal(runCondition('{ Property: a.P, In: [true] }', { 'a.P': true }),
    'yes');
});

test('StartsWith, EndsWith and Contains on string', () => {
  assert.equal(runCondition('{ Property: a.P, StartsWith: "Chr" }',
    { 'a.P': 'Chrome' }), 'yes');
  assert.equal(runCondition('{ Property: a.P, EndsWith: "ome" }',
    { 'a.P': 'Chrome' }), 'yes');
  assert.equal(runCondition('{ Property: a.P, Contains: "hro" }',
    { 'a.P': 'Chrome' }), 'yes');
  assert.equal(runCondition('{ Property: a.P, StartsWith: "chr" }',
    { 'a.P': 'Chrome' }), 'no');
});

// ---------------------------------------------------------------------
// Evaluation is two valued, DESIGN.md 2.6.
// ---------------------------------------------------------------------

test('All is false if any member is false', () => {
  const yaml = '{ All: [ { Property: a.P, Eq: true }, ' +
    '{ Property: a.Q, Eq: true } ] }';
  assert.equal(runCondition(yaml, { 'a.P': true, 'a.Q': false }), 'no');
});

test('All is true where every member is true', () => {
  const yaml = '{ All: [ { Property: a.P, Eq: true }, ' +
    '{ Property: a.Q, Eq: true } ] }';
  assert.equal(runCondition(yaml, { 'a.P': true, 'a.Q': true }), 'yes');
});

test('Any is true where at least one member is true', () => {
  const yaml = '{ Any: [ { Property: a.P, Eq: true }, ' +
    '{ Property: a.Q, Eq: true } ] }';
  assert.equal(runCondition(yaml, { 'a.P': true, 'a.Q': false }), 'yes');
});

test('Any is false where every member is false', () => {
  const yaml = '{ Any: [ { Property: a.P, Eq: true }, ' +
    '{ Property: a.Q, Eq: true } ] }';
  assert.equal(runCondition(yaml, { 'a.P': false, 'a.Q': false }), 'no');
});

test('Not turns true into false and false into true', () => {
  assert.equal(runCondition('{ Not: { Property: a.P, Eq: true } }',
    { 'a.P': false }), 'yes');
  assert.equal(runCondition('{ Not: { Property: a.P, Eq: true } }',
    { 'a.P': true }), 'no');
});

test('a check reference gives the referenced check result', () => {
  const checks = 'Checks:\n  One: { Property: a.P, Eq: true }\n';
  assert.equal(runCondition('{ Check: One }', { 'a.P': true }, checks), 'yes');
  assert.equal(runCondition('{ Check: One }', { 'a.P': false }, checks), 'no');
});

// ---------------------------------------------------------------------
// Aggregates.
// ---------------------------------------------------------------------

const AGGREGATE_CHECKS = 'Checks:\n' +
  '  One:   { Property: a.P, Eq: true }\n' +
  '  Two:   { Property: a.Q, Eq: true }\n' +
  '  Three: { Property: a.R, Eq: true }\n';

test('Passed and Failed always add up to the size of the group', () => {
  const properties = { 'a.P': true, 'a.Q': false, 'a.R': false };
  assert.equal(runCondition('{ Passed: Checks, Eq: 1 }', properties,
    AGGREGATE_CHECKS), 'yes');
  assert.equal(runCondition('{ Failed: Checks, Eq: 2 }', properties,
    AGGREGATE_CHECKS), 'yes');
});

test('an aggregate over a named list of checks counts only those', () => {
  const properties = { 'a.P': true, 'a.Q': true, 'a.R': false };
  assert.equal(runCondition('{ Passed: [One, Two], Eq: 2 }', properties,
    AGGREGATE_CHECKS), 'yes');
});

test('an aggregate is compared against a whole number', () => {
  const properties = { 'a.P': true, 'a.Q': false, 'a.R': false };
  assert.equal(runCondition('{ Failed: Checks, Gt: 1 }', properties,
    AGGREGATE_CHECKS), 'yes');
  assert.equal(runCondition('{ Failed: Checks, Gt: 2 }', properties,
    AGGREGATE_CHECKS), 'no');
});

// ---------------------------------------------------------------------
// The conversion table, DESIGN.md section 3.
// ---------------------------------------------------------------------

test('bool accepts a native boolean and the strings true and false', () => {
  assert.deepEqual(convertValue(true, 'bool'), { ok: true, value: true });
  assert.deepEqual(convertString('TRUE', 'bool'), { ok: true, value: true });
  assert.deepEqual(convertString('  false  ', 'bool'),
    { ok: true, value: false });
});

test('bool rejects N/A, Unknown, 1, yes and empty', () => {
  for (const raw of ['N/A', 'Unknown', '1', 'yes', '']) {
    assert.equal(convertString(raw, 'bool').ok, false,
      `'${raw}' must not be read as a bool`);
  }
});

test('int accepts integers and signed digit strings', () => {
  assert.deepEqual(convertValue(8, 'int'), { ok: true, value: 8 });
  assert.deepEqual(convertString('-8', 'int'), { ok: true, value: -8 });
  assert.deepEqual(convertString('+8', 'int'), { ok: true, value: 8 });
});

test('int rejects 1.0, Unknown and empty', () => {
  for (const raw of ['1.0', 'Unknown', '']) {
    assert.equal(convertString(raw, 'int').ok, false,
      `'${raw}' must not be read as an int`);
  }
  assert.equal(convertValue(1.5, 'int').ok, false);
});

test('int is a signed 32 bit whole number and nothing wider', () => {
  // The format fixes the width so that one script gives one answer in
  // every language. JavaScript would otherwise carry whole numbers far
  // past the point where .NET and Java stop, and a value between the two
  // limits would be readable in one language and absent in another,
  // which changes the answer rather than only the wording.
  assert.deepEqual(convertString('2147483647', 'int'),
    { ok: true, value: 2147483647 });
  assert.deepEqual(convertString('-2147483648', 'int'),
    { ok: true, value: -2147483648 });
  for (const raw of ['2147483648', '-2147483649', '3000000000',
    '9007199254740991']) {
    assert.equal(convertString(raw, 'int').ok, false,
      `'${raw}' is outside the range of an int and must not be read`);
  }
  assert.equal(convertValue(3000000000, 'int').ok, false);
  assert.equal(convertValue(2147483647, 'int').ok, true);
});

test('a whole number too large for an int infers double, not int', () => {
  // The same limit decides the type a literal written in a script takes,
  // so a script comparing against 3000000000 reads the property as a
  // double rather than quietly inferring an int the value cannot fit.
  assert.equal(inferType(2147483647), 'int');
  assert.equal(inferType(2147483648), 'double');
  assert.equal(inferType(-2147483649), 'double');
});

test('double accepts integers, floats and exponent strings', () => {
  assert.deepEqual(convertValue(1, 'double'), { ok: true, value: 1 });
  assert.deepEqual(convertValue(1.5, 'double'), { ok: true, value: 1.5 });
  assert.deepEqual(convertString('-1.5e2', 'double'),
    { ok: true, value: -150 });
});

test('double rejects Unknown and empty', () => {
  for (const raw of ['Unknown', '']) {
    assert.equal(convertString(raw, 'double').ok, false);
  }
});

test('string takes a string as it is and gives numbers and booleans a canonical form', () => {
  assert.deepEqual(convertValue('N/A', 'string'), { ok: true, value: 'N/A' });
  assert.deepEqual(convertValue(true, 'string'), { ok: true, value: 'True' });
  assert.deepEqual(convertValue(false, 'string'), { ok: true, value: 'False' });
  assert.deepEqual(convertValue(8, 'string'), { ok: true, value: '8' });
});

test('the string form of a value is read the same as the native form', () => {
  assert.equal(runCondition('{ Property: a.P, Eq: false }',
    { 'a.P': { String: 'False' } }), 'yes');
  assert.equal(runCondition('{ Property: a.P, Ge: 8 }',
    { 'a.P': { String: '9' } }), 'yes');
});

test('a list of weighted values takes the value with the highest weight', () => {
  const properties = {
    'a.P': [{ Value: 'Low', Weight: 1 }, { Value: 'High', Weight: 5 }]
  };
  assert.equal(runCondition('{ Property: a.P, Eq: "High" }', properties),
    'yes');
});

test('a plain list where a scalar is inferred is not available', () => {
  const result = runCondition('{ Property: a.P, Eq: "High" }',
    { 'a.P': ['one', 'two'] });
  assert.deepEqual(result.missing, ['a.P']);
  assert.ok(result.message.includes(
    "'a.P' (held a list where a single value is needed)."), result.message);
});

// ---------------------------------------------------------------------
// Source properties. A property is either there or it is not.
// ---------------------------------------------------------------------

const SOURCES = `
Format: 1
Name: Strict
Version: 1.0.0
Output:
  Name: Strict
  Description: A property read from two sources.
  ValueType: string
  IsList: false
Rules:
  - When:
      All:
        - { Property: device.IsVisible, Eq: true }
        - { Property: device.WebDriver, Eq: "None" }
    Then: High
  - Else: Low
`;

test('a source property that is absent makes the output a missing value', () => {
  const { model, faults } = validateText(SOURCES, { name: 'Strict' });
  assert.deepEqual(faults, []);
  const result = evaluate(model, { 'device.WebDriver': 'None' });
  assert.deepEqual(result.missing, ['device.IsVisible']);
  assert.equal(result.value, undefined);
});

test('the missing message names every absent property, not only the first', () => {
  const { model } = validateText(SOURCES, { name: 'Strict' });
  const result = evaluate(model, {});
  assert.deepEqual(result.missing, ['device.IsVisible', 'device.WebDriver']);
  assert.equal(result.message,
    "Derived property 'Strict' has no value because 2 source properties " +
    "were not available. 'device.IsVisible' (element 'device' has no value " +
    "for 'IsVisible': property not present on this request). " +
    "'device.WebDriver' (element 'device' has no value for 'WebDriver': " +
    'property not present on this request). Usual causes are the element ' +
    'that supplies the property not being in the pipeline, or being added ' +
    'after this element rather than before it, the property being excluded ' +
    'in the engine configuration, the property not being included in the ' +
    'resource key, or JavaScript that populates the property not having ' +
    'run yet.');
});

test('the missing message is singular for one property', () => {
  const { model } = validateText(SOURCES, { name: 'Strict' });
  const result = evaluate(model, { 'device.IsVisible': true });
  assert.ok(result.message.includes(
    'because 1 source property was not available.'), result.message);
});

test('the missing message carries the source no value message where there is one', () => {
  const { model } = validateText(SOURCES, { name: 'Strict' });
  const result = evaluate(model, {
    'device.IsVisible': true,
    'device.WebDriver': { NoValue: 'the JavaScript has not run yet' }
  });
  assert.ok(result.message.includes(
    "'device.WebDriver' (element 'device' has no value for 'WebDriver': " +
    'the JavaScript has not run yet).'), result.message);
});

test('an invalid value says what it held and what it could not be read as', () => {
  const { model } = validateText(SOURCES, { name: 'Strict' });
  const result = evaluate(model, {
    'device.IsVisible': 'N/A',
    'device.WebDriver': 'None'
  });
  assert.ok(result.message.includes(
    "'device.IsVisible' (held 'N/A' which cannot be read as bool)."),
  result.message);
});

test('a property named only in a check is read like any other', () => {
  const checks = 'Checks:\n  One: { Property: a.Q, Eq: true }\n';
  const result = runCondition('{ Property: a.P, Eq: true }',
    { 'a.P': true }, checks);
  assert.deepEqual(result.missing, ['a.Q']);
});

test('the properties are named in the order the script first names them', () => {
  const checks = 'Checks:\n  One: { Property: a.Z, Eq: true }\n';
  const result = runCondition('{ Property: a.A, Eq: true }', {}, checks);
  assert.deepEqual(result.missing, ['a.Z', 'a.A']);
});

// ---------------------------------------------------------------------
// Rule order and Else.
// ---------------------------------------------------------------------

test('rules are evaluated in order and the first match wins', () => {
  const text = `
Format: 1
Name: Ordered
Version: 1.0.0
Output:
  Name: Ordered
  Description: Which rule matched.
  ValueType: string
  IsList: false
Rules:
  - When: { Property: a.P, Ge: 1 }
    Then: First
  - When: { Property: a.P, Ge: 2 }
    Then: Second
  - Else: None
`;
  const { model, faults } = validateText(text, { name: 'Ordered' });
  assert.deepEqual(faults, []);
  assert.equal(evaluate(model, { 'a.P': 5 }).value, 'First');
  assert.equal(evaluate(model, { 'a.P': 0 }).value, 'None');
});

test('DefaultValue is metadata and nothing reads it while a request runs', () => {
  const text = `
Format: 1
Name: Defaulted
Version: 1.0.0
Output:
  Name: Defaulted
  Description: A property carrying a default.
  ValueType: string
  IsList: false
  DefaultValue: Unknown
Rules:
  - When: { Property: a.P, Eq: true }
    Then: High
  - Else: Low
`;
  const { model, faults } = validateText(text, { name: 'Defaulted' });
  assert.deepEqual(faults, []);
  assert.equal(model.output.DefaultValue, 'Unknown');
  // The Else catches the request rather than the default being reached.
  assert.equal(evaluate(model, { 'a.P': false }).value, 'Low');
  // An absent property is a missing value rather than the default.
  assert.deepEqual(evaluate(model, {}).missing, ['a.P']);
});

// ---------------------------------------------------------------------
// The trace.
// ---------------------------------------------------------------------

test('the trace names each check state and the rule that matched', () => {
  const text = `
Format: 1
Name: Traced
Version: 1.0.0
Output:
  Name: Traced
  Description: A property whose evaluation is traced.
  ValueType: string
  IsList: false
Checks:
  One: { Property: a.P, Eq: true }
  Two: { Property: a.Q, Eq: true }
Rules:
  - When: { Passed: Checks, Ge: 1 }
    Then: High
  - Else: Low
`;
  const { model, faults } = validateText(text, { name: 'Traced' });
  assert.deepEqual(faults, []);
  const result = evaluate(model, { 'a.P': true, 'a.Q': false },
    { trace: true });
  assert.equal(result.value, 'High');
  assert.deepEqual(result.trace.checks, [
    { name: 'One', state: 'true' },
    { name: 'Two', state: 'false' }
  ]);
  assert.equal(result.trace.matchedRule, 0);
  assert.equal(result.trace.matchedBy, 'When');
  assert.deepEqual(result.trace.properties, [
    { name: 'a.P', available: true, value: true, reason: null },
    { name: 'a.Q', available: true, value: false, reason: null }
  ]);
});

test('the trace of a missing value names the property that was absent', () => {
  const { model } = validateText(SOURCES, { name: 'Strict' });
  const result = evaluate(model, { 'device.IsVisible': true },
    { trace: true });
  assert.deepEqual(result.trace.properties[1], {
    name: 'device.WebDriver',
    available: false,
    value: undefined,
    reason: "element 'device' has no value for 'WebDriver': property not " +
      'present on this request'
  });
});

test('property lookup ignores case', () => {
  assert.equal(runCondition('{ Property: a.P, Eq: true }',
    { 'A.p': true }), 'yes');
});

test('the same model gives the same answer however many times it is run', () => {
  const { model } = validateText(SOURCES, { name: 'Strict' });
  const properties = { 'device.IsVisible': true, 'device.WebDriver': 'None' };
  const first = evaluate(model, properties).value;
  for (let i = 0; i < 100; i++) {
    assert.equal(evaluate(model, properties).value, first);
  }
  assert.equal(first, 'High');
});

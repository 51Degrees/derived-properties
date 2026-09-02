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
 * Tests schema/format-1.schema.json.
 *
 * The schema is the second of two ways a script is checked. Editors and
 * build pipelines that understand JSON Schema use the schema, and
 * tools/validate.mjs is the full check that the format documentation
 * describes. The schema therefore catches a subset of what validate.mjs
 * catches, and these tests pin down which subset, so that an edit to the
 * schema that quietly stops catching a fault fails here rather than
 * reaching an author as a script that looked acceptable in an editor.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv/dist/2020.js';
import { parse } from '../parse.mjs';
import { validateText } from '../validate.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const SCHEMA_PATH = join(ROOT, 'schema', 'format-1.schema.json');
const SCRIPTS = join(ROOT, 'scripts');
const INVALID = join(ROOT, 'tests', 'invalid');

const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));

/**
 * Compiles the schema, collecting anything Ajv wants to say about it.
 *
 * Strict mode is on, so a keyword the schema misspells or a shape Ajv
 * cannot make sense of stops the compile rather than being ignored.
 * Union types are allowed because the format has two of them on purpose,
 * being a literal, which is a string, a number or a boolean, and a value
 * name under Output.Values, which is a string or a whole number.
 *
 * Ajv's strictRequired check is turned off because it reads each
 * subschema on its own. An aggregate condition names Passed and Failed in
 * an anyOf and defines both in the properties of the object around that
 * anyOf, which Ajv does not follow, so the check reports a fault that is
 * not there.
 *
 * @returns {{validate: Function, warnings: string[]}}
 */
function compileSchema() {
  const warnings = [];
  const record = (...parts) => warnings.push(parts.join(' '));
  const ajv = strictAjv({
    allErrors: true,
    logger: { log: record, warn: record, error: record }
  });
  return { validate: ajv.compile(schema), warnings };
}

/** An Ajv in strict mode, settled the same way everywhere in this file. */
function strictAjv(options = {}) {
  return new Ajv({
    strict: true,
    strictRequired: false,
    allowUnionTypes: true,
    ...options
  });
}

const { validate: checkAgainstSchema, warnings: compileWarnings } =
  compileSchema();

/**
 * Compiles one definition out of the schema on its own, so a test can put
 * a single condition or a single rule through the part of the schema that
 * describes it and read the error without the rest of a script around it.
 *
 * @param {string} pointer a JSON pointer into the schema, for example
 *   `#/$defs/condition`.
 */
function checkerFor(pointer) {
  return strictAjv({ allErrors: true }).compile({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $ref: pointer,
    $defs: schema.$defs
  });
}

const checkCondition = checkerFor('#/$defs/condition');
const checkRule = checkerFor('#/$defs/rule');
const checkValues = checkerFor('#/$defs/output/properties/Values');

/** The first schema error, shortened for the printed table. */
function firstError(errors) {
  if (!errors || errors.length === 0) return '';
  const error = errors[0];
  const where = error.instancePath === '' ? '(root)' : error.instancePath;
  return `${where} ${error.keyword} ${error.message}`.slice(0, 64);
}

/**
 * Runs one invalid case through both checks.
 *
 * The outcome of the schema is one of three words. `rejected` means the
 * schema alone found a fault. `accepted` means the schema found nothing
 * and only validate.mjs rejects the script. `unparsable` means the text
 * is not YAML at all, so no document ever reaches the schema.
 */
function classify(file) {
  const document = parse(readFileSync(join(INVALID, file), 'utf8')).document;
  const scriptText = document.Script;
  assert.equal(typeof scriptText, 'string',
    `${file}: Script must hold the text of the script to reject`);
  const validator = validateText(scriptText, {
    name: document.Name ?? null, source: file
  });
  let outcome;
  let reason = '';
  try {
    const script = parse(scriptText).document;
    if (checkAgainstSchema(script)) {
      outcome = 'accepted';
    } else {
      outcome = 'rejected';
      reason = firstError(checkAgainstSchema.errors);
    }
  } catch (error) {
    outcome = 'unparsable';
    reason = error.message.slice(0, 64);
  }
  return {
    file,
    validatorRejects: validator.model === null,
    faults: validator.faults,
    schema: outcome,
    reason
  };
}

const invalidFiles = readdirSync(INVALID)
  .filter(f => /\.ya?ml$/i.test(f))
  .sort();
const classified = invalidFiles.map(classify);

/**
 * The cases the schema alone catches. Each name was worked out by running
 * the case and then written down here on purpose, so that a change to the
 * schema that stops catching one of them fails this file. Add a name here
 * when a schema edit deliberately widens what the schema catches, and move
 * a name to SCHEMA_MISSES only where the reason for giving the case up is
 * understood.
 */
const SCHEMA_CATCHES = [
  '02-format-not-one.yaml',
  '03-unknown-top-level-key.yaml',
  '04-unknown-output-key.yaml',
  '05-name-not-an-identifier.yaml',
  '07-value-type-not-in-format-1.yaml',
  '08-is-list-true.yaml',
  '09-unknown-operator.yaml',
  '10-two-operators.yaml',
  '11-operator-not-allowed-on-type.yaml',
  '12-null-literal.yaml',
  '18-when-and-else-together.yaml',
  '19-aggregate-as-a-rule-value.yaml',
  '20-optional-block-removed.yaml',
  '21-required-key-missing.yaml',
  '22-key-of-the-wrong-type.yaml',
  '24-source-property-not-qualified.yaml',
  '26-rules-do-not-end-in-an-else.yaml',
  '27-present-operator-removed.yaml',
  '28-evaluated-aggregate-removed.yaml',
  '29-nested-aggregate-operand.yaml'
];

/**
 * The cases the schema alone cannot catch, each with the reason. A JSON
 * Schema describes the shape of one document and has no way to compare
 * one part of a document with another part, or with the file name, so
 * every rule below is left to tools/validate.mjs.
 */
const SCHEMA_MISSES = {
  '06-name-not-the-file-name.yaml':
    'the file name is not part of the document',
  '13-conflicting-inferred-types.yaml':
    'the same property must infer one type across the whole script',
  '14-undefined-check-reference.yaml':
    'a Check reference must name a check the script defines',
  '15-group-names-unknown-check.yaml':
    'every name in an aggregate group must be a check the script defines',
  '16-then-outside-values.yaml':
    'every Then must name one of the entries under Output.Values',
  '17-else-not-last.yaml':
    'a schema can say that some rule is an Else but not that the Else is ' +
    'the last rule, so an Else in front of a When and Then passes the ' +
    'schema and only validate.mjs rejects it',
  '23-default-value-outside-values.yaml':
    'DefaultValue must name one of the entries under Output.Values',
  '25-int-and-double-conflict.yaml':
    'the same property must infer one type across the whole script, and ' +
    'the type of a number comes from the value rather than from the way ' +
    'the value was written, so 2.0 infers int and 2.5 infers double'
};

/** The one case whose text is not YAML, so no document reaches the schema. */
const SCHEMA_CANNOT_PARSE = ['01-not-parsable.yaml'];

test('the schema compiles under Ajv in strict mode', () => {
  assert.equal(typeof checkAgainstSchema, 'function');
  assert.deepEqual(compileWarnings, [],
    'Ajv had something to say about the schema while compiling it');
});

test('the schema is itself a valid 2020-12 schema', () => {
  const ajv = strictAjv();
  assert.ok(ajv.validateSchema(schema),
    'the schema does not meet the meta schema. ' +
    JSON.stringify(ajv.errors, null, 2));
});

test('every script in scripts/ parses and matches the schema', () => {
  const files = readdirSync(SCRIPTS)
    .filter(f => /\.(ya?ml|json)$/i.test(f))
    .sort();
  assert.ok(files.length > 0, 'scripts/ holds no scripts to check');
  for (const file of files) {
    const text = readFileSync(join(SCRIPTS, file), 'utf8');
    let document;
    try {
      document = parse(text).document;
    } catch (error) {
      assert.fail(`scripts/${file} does not parse: ${error.message}`);
    }
    assert.ok(checkAgainstSchema(document),
      `scripts/${file} does not match the schema: ` +
      JSON.stringify(checkAgainstSchema.errors, null, 2));
  }
});

test('every case in tests/invalid is rejected by validate.mjs', () => {
  assert.ok(classified.length > 0, 'tests/invalid holds no cases');
  for (const row of classified) {
    assert.ok(row.validatorRejects,
      `tests/invalid/${row.file} was expected to be rejected but it ` +
      'validated');
    assert.ok(row.faults.length > 0,
      `tests/invalid/${row.file} was rejected with no fault to show`);
  }
});

test('the schema alone catches the cases it is expected to catch', () => {
  // The table is printed so that a reader of the test output can see how
  // much of the format the schema covers without reading the schema.
  console.table(classified.map(row => ({
    Case: row.file,
    'Schema alone': row.schema,
    Reason: row.schema === 'accepted'
      ? SCHEMA_MISSES[row.file] ?? '(not classified)'
      : row.reason
  })));

  const named = [
    ...SCHEMA_CATCHES,
    ...Object.keys(SCHEMA_MISSES),
    ...SCHEMA_CANNOT_PARSE
  ].sort();
  assert.deepEqual(named, invalidFiles,
    'every case in tests/invalid must be named in exactly one of ' +
    'SCHEMA_CATCHES, SCHEMA_MISSES and SCHEMA_CANNOT_PARSE. Run the case ' +
    'and add the file name to whichever list its outcome puts it in');

  const outcome = new Map(classified.map(row => [row.file, row.schema]));
  for (const file of SCHEMA_CATCHES) {
    assert.equal(outcome.get(file), 'rejected',
      `the schema no longer catches tests/invalid/${file} on its own. ` +
      'Either put the rule back into the schema, or move the file name ' +
      'into SCHEMA_MISSES with the reason it was given up');
  }
  for (const file of Object.keys(SCHEMA_MISSES)) {
    assert.equal(outcome.get(file), 'accepted',
      `the schema now catches tests/invalid/${file}, which SCHEMA_MISSES ` +
      'says it cannot. Move the file name into SCHEMA_CATCHES');
  }
  for (const file of SCHEMA_CANNOT_PARSE) {
    assert.equal(outcome.get(file), 'unparsable',
      `tests/invalid/${file} was expected to be text that is not YAML`);
  }
});

// ---------------------------------------------------------------------
// What the schema must tolerate.
//
// A schema that is too tight is as much of a fault as one that is too
// loose, because an author whose editor underlines a valid script has no
// way to tell which of the two is wrong. Each script below is valid, and
// each is checked against the schema and against validate.mjs, so neither
// check can drift away from the other without a failure here.
// ---------------------------------------------------------------------

/** An Output block carrying every field the format allows. */
const EVERY_OUTPUT_FIELD = `
Format: 1
Name: Everything
Version: 2.1.0-beta.3+build5
Deprecated: true
DeprecationNote: Use HumanConfidence instead.
Output:
  Name: Everything
  Description: An output that carries every optional metadata field.
  ValueType: string
  StoredValueType: string
  DefaultValue: Unknown
  IsList: false
  IsMandatory: true
  IsObsolete: false
  Category: General
  IsPopular: true
  ExportValues: true
  Url: https://51degrees.com/documentation
  DisplayOrder: 3
  PropertyId: 4242
  VendorIds: [ device ]
  Dependencies: [ device.IsCrawler ]
  Values:
    - { Name: High, Description: High confidence. }
    - { Name: Unknown }
Rules:
  - When: { Property: device.IsCrawler, Eq: false }
    Then: High
  - Else: Unknown
`;

/** Every condition form and every operator, in one script. */
const EVERY_CONDITION = `
Format: 1
Name: Conditions
Version: 1.0.0
Output:
  Name: Conditions
  Description: An output reached through every condition form.
  ValueType: string
  IsList: false
  DefaultValue: Low
  Values:
    - { Name: High, Description: High. }
    - { Name: Low, Description: Low. }
Checks:
  NotCrawler: { Property: device.IsCrawler, Eq: false }
  Human:      { Property: ip.HumanProbability, Ge: 8 }
Rules:
  - When:
      All:
        - { Check: NotCrawler }
        - Any:
            - { Property: device.IsHeadless, Ne: true }
            - Not: { Property: device.BrowserName, In: [ Chrome, Firefox ] }
        - All:
            - { Property: device.PlatformName, NotIn: [ Windows ] }
            - { Property: device.WebDriver, StartsWith: Chrome }
            - { Property: device.DeviceType, EndsWith: Phone }
            - { Property: device.HardwareVendor, Contains: "51" }
        - { Property: device.BrowserReleaseYear, Gt: 2000 }
        - { Property: device.BrowserReleaseYear, Le: 2100 }
        - { Property: device.BrowserReleaseAge, Lt: 12 }
        - { Property: device.ScreenInchesDiagonal, Ge: 5.5 }
        - { Passed: [ NotCrawler, Human ], Ge: 1 }
        - { Failed: Checks, Ne: 3 }
    Then: High
  - Else: Low
`;

/** The shortest script the format allows. */
const SMALLEST = `
Format: 1
Name: Smallest
Version: 1.0.0
Output:
  Name: Smallest
  Description: The smallest script there is.
  ValueType: bool
  IsList: false
Rules:
  - Else: false
`;

const TOLERATED = [
  ['an Output block carrying every field', 'Everything', EVERY_OUTPUT_FIELD],
  ['every condition form and every operator', 'Conditions', EVERY_CONDITION],
  ['the smallest script the format allows', 'Smallest', SMALLEST]
];

for (const [what, name, text] of TOLERATED) {
  test(`the schema accepts ${what}`, () => {
    const document = parse(text).document;
    assert.ok(checkAgainstSchema(document),
      `the schema rejected a valid script, being ${what}: ` +
      JSON.stringify(checkAgainstSchema.errors, null, 2));
  });

  test(`validate.mjs accepts ${what}`, () => {
    const result = validateText(text, { name, source: `${name} (test)` });
    assert.notEqual(result.model, null,
      `validate.mjs rejected a valid script, being ${what}: ` +
      JSON.stringify(result.faults, null, 2));
  });
}

// The shapes below are each written out on their own, because each one
// turns on a part of the schema where a small edit could break a valid
// script without breaking any of the scripts in scripts/.
const CONDITION_SHAPES = [
  ['a check reference', { Check: 'NotCrawler' }],
  ['a count compared with a whole number', { Failed: 'Checks', Eq: 0 }],
  ['a count over a named group', { Failed: ['NotCrawler'], Le: 1 }],
  ['an All nested inside an All',
    { All: [{ All: [{ Property: 'device.IsCrawler', Eq: false }] }] }],
  ['a Not around an Any',
    { Not: { Any: [{ Check: 'NotCrawler' }, { Failed: 'Checks', Gt: 0 }] } }]
];

for (const [what, condition] of CONDITION_SHAPES) {
  test(`the schema accepts ${what} as a condition`, () => {
    assert.ok(checkCondition(condition),
      `the schema rejected ${what}, being ` +
      `${JSON.stringify(condition)}. ` +
      JSON.stringify(checkCondition.errors));
  });
}

const RULE_SHAPES = [
  ['a When with a Then', { When: { Check: 'NotCrawler' }, Then: 'High' }],
  ['an Else holding a literal', { Else: 'Low' }],
  ['a Then holding a whole number', { When: { Check: 'A' }, Then: 4 }],
  ['a Then holding a boolean', { When: { Check: 'A' }, Then: false }]
];

for (const [what, rule] of RULE_SHAPES) {
  test(`the schema accepts ${what} as a rule`, () => {
    assert.ok(checkRule(rule),
      `the schema rejected ${what}, being ${JSON.stringify(rule)}. ` +
      JSON.stringify(checkRule.errors));
  });
}

test('a Values entry takes a Name on its own or with a Description', () => {
  const values = [
    { Name: 'High', Description: 'High confidence.' },
    { Name: 'Low' },
    { Name: 4 }
  ];
  assert.ok(checkValues(values),
    'the schema rejected a Values list. ' +
    JSON.stringify(checkValues.errors));
});

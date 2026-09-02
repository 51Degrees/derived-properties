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
 * Checks a parsed script against format 1 and turns it into the model the
 * evaluator runs. Every fault is collected rather than stopping at the
 * first, so an author sees everything wrong with a file in one go.
 *
 * Each fault is `{ script, source, path, line, message }` where `path` is a
 * place in the document such as `Rules[3].When.All[1]`.
 */

import { parse, lineOf, ParseError } from './parse.mjs';
import { convertString, INT_MIN, INT_MAX } from './evaluate.mjs';

/** The value types format 1 allows for an output property. */
export const VALUE_TYPES = ['string', 'bool', 'int', 'double'];

/** The comparison operators, and the inferred types each is allowed on. */
export const OPERATORS = {
  Eq: ['bool', 'int', 'double', 'string'],
  Ne: ['bool', 'int', 'double', 'string'],
  Gt: ['int', 'double'],
  Ge: ['int', 'double'],
  Lt: ['int', 'double'],
  Le: ['int', 'double'],
  In: ['bool', 'int', 'double', 'string'],
  NotIn: ['bool', 'int', 'double', 'string'],
  StartsWith: ['string'],
  EndsWith: ['string'],
  Contains: ['string']
};

/** The two counts a rule can compare a group of checks by. */
export const AGGREGATES = ['Passed', 'Failed'];

const TOP_LEVEL_KEYS = ['Format', 'Name', 'Version', 'Deprecated',
  'DeprecationNote', 'Output', 'Checks', 'Rules'];

/**
 * The Output keys, in the order the canonical form prints them. The set
 * is the one 51Degrees uses for the metadata of every property, so an
 * Output block is a complete property definition rather than a cut-down
 * one.
 */
export const OUTPUT_KEYS = ['Name', 'Description', 'ValueType',
  'StoredValueType', 'DefaultValue', 'IsList', 'IsMandatory', 'IsObsolete',
  'Category', 'IsPopular', 'ExportValues', 'Url', 'DisplayOrder',
  'PropertyId', 'VendorIds', 'Dependencies', 'Values'];

const OUTPUT_BOOLEANS = ['IsList', 'IsMandatory', 'IsObsolete', 'IsPopular',
  'ExportValues'];

const IDENTIFIER = /^[A-Za-z][A-Za-z0-9]*$/;
const SOURCE_PROPERTY = /^[A-Za-z][A-Za-z0-9]*\.[A-Za-z][A-Za-z0-9]*$/;
const SEMANTIC_VERSION =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+(?:\.[0-9A-Za-z.-]+)*)?(?:\+[0-9A-Za-z.-]+)?$/;

/**
 * Parses and validates script text.
 *
 * @param {string} text the script as YAML or JSON.
 * @param {{name?: string, source?: string}} [options] `name` is the file
 *   name without its extension, which the script's Name must equal.
 *   `source` names where the script came from, for the fault messages.
 * @returns {{model: object|null, faults: object[]}}
 */
export function validateText(text, options = {}) {
  const script = options.name ?? null;
  const source = options.source ?? 'code';
  let parsed;
  try {
    parsed = parse(text);
  } catch (error) {
    if (!(error instanceof ParseError)) throw error;
    return {
      model: null,
      faults: [{
        script, source, path: '', line: error.line, message: error.message
      }]
    };
  }
  return validate(parsed, options);
}

/**
 * Validates an already parsed script.
 *
 * @param {object} parsed what `parse` returned.
 * @param {{name?: string, source?: string}} [options]
 * @returns {{model: object|null, faults: object[]}}
 */
export function validate(parsed, options = {}) {
  const context = new Context(parsed, options);
  const model = buildModel(context);
  return context.faults.length > 0
    ? { model: null, faults: context.faults }
    : { model, faults: [] };
}

/**
 * The message an implementation raises when a script does not validate,
 * being one line per fault.
 */
export function faultsMessage(faults) {
  return faults.map(f => {
    const where = f.path === '' ? '(document)' : f.path;
    const line = f.line === null || f.line === undefined
      ? '' : ` line ${f.line}`;
    return `${f.script ?? 'script'} (${f.source})${line} at ${where}: ` +
      f.message;
  }).join('\n');
}

// ---------------------------------------------------------------------

class Context {
  constructor(parsed, options) {
    this.parsed = parsed;
    this.document = parsed.document;
    this.script = options.name ?? null;
    this.source = options.source ?? 'code';
    this.faults = [];
    // Where each source property was first seen, its inferred type and the
    // path that inferred it, so a conflict can name both places.
    this.properties = new Map();
  }

  fault(path, node, message) {
    this.faults.push({
      script: this.script,
      source: this.source,
      path,
      line: lineOf(this.parsed, node),
      message
    });
  }
}

/**
 * Reads a key from a mapping without regard to case, returning the value
 * and the key as it was actually written.
 */
function get(mapping, name) {
  if (mapping === null || typeof mapping !== 'object') return undefined;
  const lower = name.toLowerCase();
  for (const key of Object.keys(mapping)) {
    if (key.toLowerCase() === lower) return mapping[key];
  }
  return undefined;
}

function has(mapping, name) {
  return get(mapping, name) !== undefined;
}

/** The keys of a mapping that are not in the allowed list. */
function unknownKeys(mapping, allowed) {
  const lower = allowed.map(k => k.toLowerCase());
  return Object.keys(mapping).filter(k => !lower.includes(k.toLowerCase()));
}

function buildModel(context) {
  const document = context.document;

  for (const key of unknownKeys(document, TOP_LEVEL_KEYS)) {
    context.fault(key, document, `unknown key '${key}' at the top level. ` +
      `Expected one of ${TOP_LEVEL_KEYS.join(', ')}`);
  }

  const model = {
    format: readFormat(context),
    name: readName(context),
    version: readVersion(context),
    deprecated: false,
    deprecationNote: null,
    source: context.source,
    output: null,
    properties: [],
    checks: [],
    rules: []
  };

  readDeprecation(context, model);
  model.output = readOutput(context);

  // Checks are read before rules so that a rule can reference one.
  const checkNames = readCheckNames(context);
  readChecks(context, model, checkNames);
  readRules(context, model, checkNames);
  finaliseProperties(model);
  computeDependencies(model);

  return model;
}

function readFormat(context) {
  const value = get(context.document, 'Format');
  if (value === undefined) {
    context.fault('Format', context.document,
      "required key 'Format' is missing");
    return null;
  }
  if (value !== 1) {
    context.fault('Format', context.document,
      `Format must be 1, found ${JSON.stringify(value)}`);
    return null;
  }
  return 1;
}

function readName(context) {
  const value = get(context.document, 'Name');
  if (value === undefined) {
    context.fault('Name', context.document, "required key 'Name' is missing");
    return null;
  }
  if (typeof value !== 'string') {
    context.fault('Name', context.document,
      `Name expected a string, found ${typeOf(value)}`);
    return null;
  }
  if (!IDENTIFIER.test(value)) {
    context.fault('Name', context.document,
      `script name '${value}' does not match the pattern ${IDENTIFIER.source}`);
    return value;
  }
  if (context.script !== null && context.script !== value) {
    context.fault('Name', context.document,
      `script name '${value}' must equal the file name '${context.script}'`);
  }
  return value;
}

function readVersion(context) {
  const value = get(context.document, 'Version');
  if (value === undefined) {
    context.fault('Version', context.document,
      "required key 'Version' is missing");
    return null;
  }
  if (typeof value !== 'string' || !SEMANTIC_VERSION.test(value)) {
    context.fault('Version', context.document,
      `Version expected a semantic version such as 1.0.0, found ` +
      `${JSON.stringify(value)}`);
    return null;
  }
  return value;
}

function readDeprecation(context, model) {
  const deprecated = get(context.document, 'Deprecated');
  if (deprecated !== undefined) {
    if (typeof deprecated !== 'boolean') {
      context.fault('Deprecated', context.document,
        `Deprecated expected a boolean, found ${typeOf(deprecated)}`);
    } else {
      model.deprecated = deprecated;
    }
  }
  const note = get(context.document, 'DeprecationNote');
  if (note !== undefined && typeof note !== 'string') {
    context.fault('DeprecationNote', context.document,
      `DeprecationNote expected a string, found ${typeOf(note)}`);
  } else if (note !== undefined) {
    model.deprecationNote = note;
  }
  if (model.deprecated && !model.deprecationNote) {
    context.fault('DeprecationNote', context.document,
      'a deprecated script must say what to use instead in DeprecationNote');
  }
  if (!model.deprecated && model.deprecationNote) {
    context.fault('DeprecationNote', context.document,
      'DeprecationNote is only allowed when Deprecated is true');
  }
}

function readOutput(context) {
  const raw = get(context.document, 'Output');
  if (raw === undefined) {
    context.fault('Output', context.document,
      "required key 'Output' is missing");
    return { Name: context.script ?? 'unknown', ValueType: null, Values: null };
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    context.fault('Output', context.document,
      `Output expected a mapping, found ${typeOf(raw)}`);
    return { Name: context.script ?? 'unknown', ValueType: null, Values: null };
  }
  for (const key of unknownKeys(raw, OUTPUT_KEYS)) {
    context.fault(`Output.${key}`, raw,
      `unknown key '${key}' under Output. A typo in a metadata field is a ` +
      `fault rather than a value that is quietly dropped`);
  }

  const output = {};

  // Name.
  const name = get(raw, 'Name');
  if (name === undefined) {
    context.fault('Output.Name', raw, "required key 'Name' is missing");
  } else if (typeof name !== 'string' || !IDENTIFIER.test(name)) {
    context.fault('Output.Name', raw,
      `Output.Name ${JSON.stringify(name)} does not match the pattern ` +
      IDENTIFIER.source);
  } else {
    output.Name = name;
  }
  if (output.Name === undefined) output.Name = context.script ?? 'unknown';

  // Description.
  const description = get(raw, 'Description');
  if (description === undefined) {
    context.fault('Output.Description', raw,
      "required key 'Description' is missing. Say what the property " +
      'asserts, not how far to trust it');
  } else if (typeof description !== 'string' || description.trim() === '') {
    context.fault('Output.Description', raw,
      `Output.Description expected a non empty string, found ` +
      typeOf(description));
  } else {
    output.Description = description;
  }

  // ValueType.
  const valueType = get(raw, 'ValueType');
  if (valueType === undefined) {
    context.fault('Output.ValueType', raw,
      "required key 'ValueType' is missing");
    output.ValueType = null;
  } else if (typeof valueType !== 'string' ||
    !VALUE_TYPES.includes(valueType.toLowerCase())) {
    context.fault('Output.ValueType', raw,
      `Output.ValueType '${valueType}' is not allowed in format 1. ` +
      `Expected one of ${VALUE_TYPES.join(', ')}`);
    output.ValueType = null;
  } else {
    output.ValueType = valueType.toLowerCase();
  }

  // IsList.
  const isList = get(raw, 'IsList');
  if (isList === undefined) {
    context.fault('Output.IsList', raw, "required key 'IsList' is missing");
  } else if (typeof isList !== 'boolean') {
    context.fault('Output.IsList', raw,
      `Output.IsList expected a boolean, found ${typeOf(isList)}`);
  } else if (isList === true) {
    context.fault('Output.IsList', raw,
      'Output.IsList must be false in format 1. List outputs are deferred');
  } else {
    output.IsList = false;
  }
  if (output.IsList === undefined) output.IsList = false;

  // Values.
  const values = get(raw, 'Values');
  output.Values = null;
  if (values !== undefined) {
    if (!Array.isArray(values)) {
      context.fault('Output.Values', raw,
        `Output.Values expected a list, found ${typeOf(values)}`);
    } else if (output.ValueType !== null &&
      output.ValueType !== 'string' && output.ValueType !== 'int') {
      context.fault('Output.Values', raw,
        `Output.Values is only allowed where ValueType is string or int, ` +
        `not ${output.ValueType}`);
    } else {
      const list = [];
      values.forEach((entry, index) => {
        const path = `Output.Values[${index}]`;
        if (entry === null || typeof entry !== 'object' ||
          Array.isArray(entry)) {
          context.fault(path, values,
            `a value expected a mapping of Name and Description, found ` +
            typeOf(entry));
          return;
        }
        for (const key of unknownKeys(entry, ['Name', 'Description'])) {
          context.fault(`${path}.${key}`, entry,
            `unknown key '${key}' in a value. Expected Name and Description`);
        }
        const valueName = get(entry, 'Name');
        if (valueName === undefined ||
          (typeof valueName !== 'string' && typeof valueName !== 'number')) {
          context.fault(`${path}.Name`, entry,
            'a value must have a Name');
          return;
        }
        const valueDescription = get(entry, 'Description');
        if (valueDescription !== undefined &&
          typeof valueDescription !== 'string') {
          context.fault(`${path}.Description`, entry,
            `a value Description expected a string, found ` +
            typeOf(valueDescription));
        }
        list.push({
          Name: valueName,
          Description: valueDescription === undefined ? null : valueDescription
        });
      });
      const seen = new Set();
      for (const entry of list) {
        const key = String(entry.Name);
        if (seen.has(key)) {
          context.fault('Output.Values', values,
            `the value '${key}' is listed more than once`);
        }
        seen.add(key);
      }
      output.Values = list;
    }
  }

  // Booleans carried through unchanged.
  for (const key of OUTPUT_BOOLEANS) {
    if (key === 'IsList') continue;
    const value = get(raw, key);
    if (value === undefined) continue;
    if (typeof value !== 'boolean') {
      context.fault(`Output.${key}`, raw,
        `Output.${key} expected a boolean, found ${typeOf(value)}`);
      continue;
    }
    output[key] = value;
  }

  // Strings and the remaining fields carried through unchanged.
  for (const [key, kind] of [['Category', 'string'], ['Url', 'string'],
    ['StoredValueType', 'string'], ['DisplayOrder', 'integer'],
    ['PropertyId', 'integer'], ['VendorIds', 'array'],
    ['Dependencies', 'array']]) {
    const value = get(raw, key);
    if (value === undefined) continue;
    if (kind === 'string' && typeof value !== 'string') {
      context.fault(`Output.${key}`, raw,
        `Output.${key} expected a string, found ${typeOf(value)}`);
      continue;
    }
    if (kind === 'integer' &&
      !(typeof value === 'number' && Number.isInteger(value))) {
      context.fault(`Output.${key}`, raw,
        `Output.${key} expected an integer, found ${typeOf(value)}`);
      continue;
    }
    if (kind === 'array' && !Array.isArray(value)) {
      context.fault(`Output.${key}`, raw,
        `Output.${key} expected a list, found ${typeOf(value)}`);
      continue;
    }
    output[key] = value;
  }

  // DefaultValue is the string form of the value, so it is checked
  // against the value type and the value list.
  const defaultValue = get(raw, 'DefaultValue');
  if (defaultValue !== undefined) {
    if (typeof defaultValue !== 'string') {
      context.fault('Output.DefaultValue', raw,
        `Output.DefaultValue expected a string holding the string form of ` +
        `the value, found ${typeOf(defaultValue)}`);
    } else {
      output.DefaultValue = defaultValue;
      if (output.ValueType !== null) {
        const converted = convertString(defaultValue, output.ValueType);
        if (!converted.ok) {
          context.fault('Output.DefaultValue', raw,
            `Output.DefaultValue '${defaultValue}' cannot be read as ` +
            output.ValueType);
        }
      }
      if (output.Values !== null &&
        !output.Values.some(v => String(v.Name) === defaultValue)) {
        context.fault('Output.DefaultValue', raw,
          `Output.DefaultValue '${defaultValue}' is not one of the values ` +
          `listed under Output.Values`);
      }
    }
  }

  return output;
}

function readCheckNames(context) {
  const raw = get(context.document, 'Checks');
  const names = [];
  if (raw === undefined) return names;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    context.fault('Checks', context.document,
      `Checks expected a mapping of names to conditions, found ${typeOf(raw)}`);
    return names;
  }
  for (const name of Object.keys(raw)) {
    if (!IDENTIFIER.test(name)) {
      context.fault(`Checks.${name}`, raw,
        `check name '${name}' does not match the pattern ${IDENTIFIER.source}`);
      continue;
    }
    names.push(name);
  }
  return names;
}

function readChecks(context, model, checkNames) {
  const raw = get(context.document, 'Checks');
  if (raw === undefined || raw === null || typeof raw !== 'object' ||
    Array.isArray(raw)) {
    return;
  }
  for (const name of checkNames) {
    const condition = readCondition(
      context, model, raw[name], `Checks.${name}`, raw, checkNames);
    model.checks.push({ name, condition });
  }
}

function readRules(context, model, checkNames) {
  const raw = get(context.document, 'Rules');
  if (raw === undefined) {
    context.fault('Rules', context.document, "required key 'Rules' is missing");
    return;
  }
  if (!Array.isArray(raw)) {
    context.fault('Rules', context.document,
      `Rules expected a list, found ${typeOf(raw)}`);
    return;
  }
  if (raw.length === 0) {
    context.fault('Rules', raw, 'Rules must hold at least one rule');
    return;
  }
  // Every script ends in an Else, so a script always chooses a value once
  // its source properties have been read and there is no runtime path for
  // no rule having matched.
  const last = raw[raw.length - 1];
  if (!has(last, 'Else')) {
    context.fault('Rules', raw,
      'the last rule must be an Else, which is what a script falls back to ' +
      'when no earlier rule matched');
  }
  raw.forEach((entry, index) => {
    const path = `Rules[${index}]`;
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      context.fault(path, raw, `a rule expected a mapping, found ` +
        typeOf(entry));
      return;
    }
    for (const key of unknownKeys(entry, ['When', 'Then', 'Else'])) {
      context.fault(`${path}.${key}`, entry,
        `unknown key '${key}' in a rule. Expected When and Then, or Else`);
    }
    const hasWhen = has(entry, 'When');
    const hasThen = has(entry, 'Then');
    const hasElse = has(entry, 'Else');
    const isLast = index === raw.length - 1;

    if (hasElse && hasWhen) {
      context.fault(path, entry,
        'a rule has both When and Else. A rule is either When with Then, ' +
        'or Else on its own');
      return;
    }
    if (hasElse && !isLast) {
      context.fault(path, entry,
        'Else is only allowed on the last rule');
      return;
    }
    if (!hasElse && !hasWhen) {
      context.fault(path, entry,
        'a rule needs a When, or an Else on the last rule');
      return;
    }
    if (hasWhen && !hasThen) {
      context.fault(path, entry, 'a rule with When needs a Then');
      return;
    }

    const valuePath = hasElse ? `${path}.Else` : `${path}.Then`;
    const value = readRuleValue(context, model,
      hasElse ? get(entry, 'Else') : get(entry, 'Then'), valuePath, entry);
    const when = hasWhen
      ? readCondition(context, model, get(entry, 'When'), `${path}.When`,
        entry, checkNames)
      : null;
    model.rules.push({ when, value });
  });
}

/**
 * Reads a Then or an Else, which is a literal of Output.ValueType and must
 * be one of Output.Values where that list is given.
 */
function readRuleValue(context, model, raw, path, node) {
  const valueType = model.output.ValueType;
  if (raw === null || raw === undefined) {
    context.fault(path, node,
      'a rule value is a null literal, which format 1 does not allow');
    return null;
  }
  if (typeof raw === 'object') {
    context.fault(path, node,
      `a rule value is a literal of the output value type, found ` +
      typeOf(raw));
    return null;
  }
  if (valueType !== null) {
    const literalType = inferType(raw);
    if (!literalMatches(literalType, valueType)) {
      context.fault(path, node,
        `expected a ${valueType} to match Output.ValueType, found ` +
        `${typeOf(raw)}`);
      return null;
    }
  }
  if (model.output.Values !== null &&
    !model.output.Values.some(v => String(v.Name) === String(raw))) {
    context.fault(path, node,
      `'${raw}' is not one of the values listed under Output.Values ` +
      `(${model.output.Values.map(v => v.Name).join(', ')})`);
    return null;
  }
  return raw;
}

// ---------------------------------------------------------------------
// Conditions.
// ---------------------------------------------------------------------

/**
 * What a condition that could not be read becomes. A fault has been
 * recorded by the time it is returned, so the model is thrown away and it
 * is never evaluated.
 */
const FAULTED_CONDITION = { kind: 'all', items: [] };

function readCondition(context, model, raw, path, parent, checkNames) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    context.fault(path, parent,
      `a condition expected a mapping, found ${typeOf(raw)}`);
    return FAULTED_CONDITION;
  }
  const keys = Object.keys(raw);
  if (keys.length === 0) {
    context.fault(path, raw, 'a condition is empty');
    return FAULTED_CONDITION;
  }
  const lower = keys.map(k => k.toLowerCase());

  if (lower.includes('property')) {
    return readComparison(context, model, raw, path, checkNames);
  }
  if (lower.includes('check')) {
    return readCheckReference(context, raw, path, keys, checkNames);
  }
  if (AGGREGATES.some(a => lower.includes(a.toLowerCase()))) {
    return readAggregateCondition(context, raw, path, keys, checkNames);
  }
  if (lower.includes('all') || lower.includes('any')) {
    const which = lower.includes('all') ? 'All' : 'Any';
    if (keys.length !== 1) {
      context.fault(path, raw,
        `${which} must be the only key of its condition, found ` +
        keys.join(', '));
    }
    const items = get(raw, which);
    if (!Array.isArray(items)) {
      context.fault(`${path}.${which}`, raw,
        `${which} expected a list of conditions, found ${typeOf(items)}`);
      return FAULTED_CONDITION;
    }
    if (items.length === 0) {
      context.fault(`${path}.${which}`, raw,
        `${which} must list at least one condition`);
      return FAULTED_CONDITION;
    }
    return {
      kind: which.toLowerCase(),
      items: items.map((item, index) => readCondition(context, model, item,
        `${path}.${which}[${index}]`, items, checkNames))
    };
  }
  if (lower.includes('not')) {
    if (keys.length !== 1) {
      context.fault(path, raw,
        `Not must be the only key of its condition, found ${keys.join(', ')}`);
    }
    return {
      kind: 'not',
      item: readCondition(context, model, get(raw, 'Not'), `${path}.Not`, raw,
        checkNames)
    };
  }
  context.fault(path, raw,
    `a condition must be a comparison, a Check reference, an aggregate, ` +
    `All, Any or Not. Found the keys ${keys.join(', ')}`);
  return FAULTED_CONDITION;
}

function readComparison(context, model, raw, path, checkNames) {
  const keys = Object.keys(raw);
  const propertyKey = keys.find(k => k.toLowerCase() === 'property');
  const property = raw[propertyKey];
  const operatorKeys = keys.filter(k => k !== propertyKey);

  if (typeof property !== 'string' || !SOURCE_PROPERTY.test(property)) {
    context.fault(`${path}.Property`, raw,
      `'${property}' is not a source property. Write it as ` +
      'elementKey.PropertyName, for example device.IsCrawler');
    return FAULTED_CONDITION;
  }
  if (operatorKeys.length === 0) {
    context.fault(path, raw,
      `a comparison on '${property}' has no operator. Expected exactly one ` +
      `of ${Object.keys(OPERATORS).join(', ')}`);
    return FAULTED_CONDITION;
  }
  const known = operatorKeys.filter(
    k => Object.keys(OPERATORS).some(o => o.toLowerCase() === k.toLowerCase()));
  for (const key of operatorKeys) {
    if (!known.includes(key)) {
      context.fault(path, raw,
        `unknown operator '${key}', expected one of ` +
        Object.keys(OPERATORS).join(', '));
    }
  }
  if (known.length === 0) return FAULTED_CONDITION;
  if (operatorKeys.length > 1) {
    context.fault(path, raw,
      `a condition takes exactly one operator, found ` +
      operatorKeys.join(', '));
    return FAULTED_CONDITION;
  }
  const op = Object.keys(OPERATORS).find(
    o => o.toLowerCase() === known[0].toLowerCase());
  const operand = raw[known[0]];

  if (operand === null || operand === undefined) {
    context.fault(`${path}.${op}`, raw,
      'a null literal is not allowed. Give the value to compare against');
    return FAULTED_CONDITION;
  }

  let type;
  if (op === 'In' || op === 'NotIn') {
    if (!Array.isArray(operand)) {
      context.fault(`${path}.${op}`, raw,
        `${op} expects a list of values, found ${typeOf(operand)}`);
      return FAULTED_CONDITION;
    }
    if (operand.length === 0) {
      context.fault(`${path}.${op}`, raw, `${op} expects a non empty list`);
      return FAULTED_CONDITION;
    }
    if (operand.some(m => m === null || m === undefined)) {
      context.fault(`${path}.${op}`, raw,
        'a null literal is not allowed in a list');
      return FAULTED_CONDITION;
    }
    const memberTypes = operand.map(inferType);
    const first = memberTypes[0];
    // int and double may sit together and the list reads as double.
    const numeric = memberTypes.every(t => t === 'int' || t === 'double');
    if (!numeric && memberTypes.some(t => t !== first)) {
      context.fault(`${path}.${op}`, raw,
        `every member of a list must be of the same type, found ` +
        memberTypes.join(', '));
      return FAULTED_CONDITION;
    }
    type = numeric
      ? (memberTypes.includes('double') ? 'double' : 'int')
      : first;
  } else {
    type = inferType(operand);
    if (type === null) {
      context.fault(`${path}.${op}`, raw,
        `the literal ${JSON.stringify(operand)} has no type format 1 knows`);
      return FAULTED_CONDITION;
    }
  }

  if (!OPERATORS[op].includes(type)) {
    context.fault(path, raw,
      `operator '${op}' is not allowed on type ${type}. It is allowed on ` +
      OPERATORS[op].join(', '));
    return FAULTED_CONDITION;
  }

  const slot = useProperty(context, model, property, type, path, raw);
  return {
    kind: 'compare',
    slot,
    property: propertyKeyOf(property),
    propertyName: property,
    op,
    operand,
    type
  };
}

function readCheckReference(context, raw, path, keys, checkNames) {
  if (keys.length !== 1) {
    context.fault(path, raw,
      `Check must be the only key of its condition, found ${keys.join(', ')}`);
  }
  const name = get(raw, 'Check');
  if (typeof name !== 'string') {
    context.fault(`${path}.Check`, raw,
      `Check expected the name of a check, found ${typeOf(name)}`);
    return FAULTED_CONDITION;
  }
  const index = checkNames.indexOf(name);
  if (index === -1) {
    context.fault(`${path}.Check`, raw,
      `check '${name}' is not defined. The checks are ` +
      (checkNames.length === 0 ? '(none)' : checkNames.join(', ')));
    return FAULTED_CONDITION;
  }
  return { kind: 'check', name, index };
}

function readAggregateCondition(context, raw, path, keys, checkNames) {
  const aggregateKeys = keys.filter(
    k => AGGREGATES.some(a => a.toLowerCase() === k.toLowerCase()));
  if (aggregateKeys.length > 1) {
    context.fault(path, raw,
      `an aggregate condition takes one of ${AGGREGATES.join(', ')}, found ` +
      aggregateKeys.join(', '));
    return FAULTED_CONDITION;
  }
  const agg = AGGREGATES.find(
    a => a.toLowerCase() === aggregateKeys[0].toLowerCase());
  const group = readGroup(context, raw[aggregateKeys[0]], `${path}.${agg}`,
    raw, checkNames);

  const operatorKeys = keys.filter(k => k !== aggregateKeys[0]);
  if (operatorKeys.length === 0) {
    context.fault(path, raw,
      `an aggregate condition has no operator. Expected exactly one of ` +
      'Eq, Ne, Gt, Ge, Lt, Le');
    return FAULTED_CONDITION;
  }
  if (operatorKeys.length > 1) {
    context.fault(path, raw,
      `a condition takes exactly one operator, found ` +
      operatorKeys.join(', '));
    return FAULTED_CONDITION;
  }
  const op = Object.keys(OPERATORS).find(
    o => o.toLowerCase() === operatorKeys[0].toLowerCase());
  if (op === undefined) {
    context.fault(path, raw,
      `unknown operator '${operatorKeys[0]}', expected one of ` +
      'Eq, Ne, Gt, Ge, Lt, Le');
    return FAULTED_CONDITION;
  }
  if (!OPERATORS[op].includes('int')) {
    context.fault(path, raw,
      `operator '${op}' is not allowed on a count, which is an int`);
    return FAULTED_CONDITION;
  }

  // A count is compared against a whole number and against nothing else.
  // Comparing one count with another was removed from the format on
  // because it is a feature with no user and the format
  // is not a programming language.
  const operand = raw[operatorKeys[0]];
  if (!(typeof operand === 'number' && Number.isInteger(operand))) {
    context.fault(`${path}.${op}`, raw,
      `an aggregate is compared with a whole number, found ` +
      typeOf(operand));
    return FAULTED_CONDITION;
  }

  return { kind: 'aggregate', agg, group, op, operand };
}

/**
 * A group is the word `Checks`, meaning every named check, or a list of
 * check names. It becomes a list of indexes, or null for every check.
 */
function readGroup(context, raw, path, node, checkNames) {
  if (typeof raw === 'string') {
    if (raw.toLowerCase() === 'checks') return null;
    context.fault(path, node,
      `a group is the word Checks, meaning every check, or a list of check ` +
      `names. Found '${raw}'`);
    return [];
  }
  if (Array.isArray(raw)) {
    const indexes = [];
    for (const name of raw) {
      if (typeof name !== 'string') {
        context.fault(path, node,
          `a group lists check names, found ${typeOf(name)}`);
        continue;
      }
      const index = checkNames.indexOf(name);
      if (index === -1) {
        context.fault(path, node,
          `check '${name}' is not defined. The checks are ` +
          (checkNames.length === 0 ? '(none)' : checkNames.join(', ')));
        continue;
      }
      indexes.push(index);
    }
    return indexes;
  }
  context.fault(path, node,
    `a group is the word Checks or a list of check names, found ` +
    typeOf(raw));
  return [];
}

// ---------------------------------------------------------------------
// Source properties.
// ---------------------------------------------------------------------

function propertyKeyOf(name) {
  return name.toLowerCase();
}

/**
 * Records that a condition names a source property, and that the literal it
 * is compared against infers a type. Returns the slot index the evaluator
 * reads the property from.
 */
function useProperty(context, model, name, type, path, node) {
  const key = propertyKeyOf(name);
  let entry = context.properties.get(key);
  if (entry === undefined) {
    entry = { key, name, type, typePath: path, slot: model.properties.length };
    context.properties.set(key, entry);
    model.properties.push(entry);
    return entry.slot;
  }
  if (entry.type !== type) {
    context.fault(path, node,
      `'${name}' is inferred as ${type} here but was already inferred as ` +
      `${entry.type} at ${entry.typePath}. Every use of a property must ` +
      'infer the same type');
  }
  return entry.slot;
}

/** The model exposes the properties without the bookkeeping fields. */
function finaliseProperties(model) {
  model.properties = model.properties.map(p => ({
    key: p.key, name: p.name, type: p.type
  }));
}

function computeDependencies(model) {
  if (model.output.Dependencies !== undefined &&
    model.output.Dependencies !== null) {
    return;
  }
  model.output.Dependencies = model.properties.map(p => p.name);
}

// ---------------------------------------------------------------------
// Literals.
// ---------------------------------------------------------------------

/**
 * The type a literal in the script infers.
 *
 * A number infers its type from the value rather than from the way the
 * value was written, so 8, 8.0 and 8e0 all infer `int`. A whole number
 * too large for a signed 32 bit integer infers `double` instead, because
 * `int` is fixed at 32 bits so that one script gives one answer in every
 * language.
 */
export function inferType(literal) {
  if (typeof literal === 'boolean') return 'bool';
  if (typeof literal === 'number') {
    if (!Number.isInteger(literal)) return 'double';
    return literal >= INT_MIN && literal <= INT_MAX ? 'int' : 'double';
  }
  if (typeof literal === 'string') return 'string';
  return null;
}

/** Whether a literal of one type may stand for a value of another. */
function literalMatches(literalType, valueType) {
  if (literalType === valueType) return true;
  // A whole number written without a decimal point reads as a double.
  return literalType === 'int' && valueType === 'double';
}

function typeOf(value) {
  if (value === null) return 'a null literal';
  if (value === undefined) return 'nothing';
  if (Array.isArray(value)) return 'a list';
  switch (typeof value) {
    case 'boolean': return 'a boolean';
    case 'number': return Number.isInteger(value) ? 'an integer' : 'a number';
    case 'string': return `a string (${JSON.stringify(value)})`;
    case 'object': return 'a mapping';
    default: return typeof value;
  }
}

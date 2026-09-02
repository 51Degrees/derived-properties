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
 * Turns the text of a derived property script into a plain JavaScript
 * object. YAML and JSON are both accepted and give the same object, which
 * is what makes the two formats interchangeable.
 *
 * Where the text is YAML the parser also records the line each mapping and
 * each sequence started on, so a validation fault can point at a line. JSON
 * carries no line numbers, and `lineOf` returns null for it.
 */

import yaml from 'js-yaml';

/** Raised when the text is not YAML or JSON, or is not a mapping. */
export class ParseError extends Error {
  constructor(message, line) {
    super(message);
    this.name = 'ParseError';
    // One based, or null where the position is not known.
    this.line = line ?? null;
  }
}

/**
 * Reads script text.
 *
 * @param {string} text the script, as YAML or as JSON.
 * @returns {{format: 'yaml'|'json', document: object, lines: WeakMap}}
 */
export function parse(text) {
  if (typeof text !== 'string') {
    throw new ParseError('script text must be a string', null);
  }
  const isJson = /^\s*\{/.test(text);
  return isJson ? parseJson(text) : parseYaml(text);
}

/**
 * The one based line a mapping or sequence in the document started on.
 *
 * @param {object} result what `parse` returned.
 * @param {object} node an object or array taken from `result.document`.
 * @returns {number|null} the line, or null when it is not known.
 */
export function lineOf(result, node) {
  if (result === null || result === undefined) return null;
  if (node === null || typeof node !== 'object') return null;
  const line = result.lines.get(node);
  return line === undefined ? null : line;
}

function parseJson(text) {
  let document;
  try {
    document = JSON.parse(text);
  } catch (error) {
    throw new ParseError(`the text is not valid JSON: ${error.message}`, null);
  }
  requireMapping(document);
  const lines = new WeakMap();
  requireDistinctKeys(document, lines);
  return { format: 'json', document, lines };
}

function parseYaml(text) {
  const lines = new WeakMap();
  // js-yaml does not expose node positions from `load`, but it does call a
  // listener as the parser opens and closes each node. The line recorded at
  // "open" is paired with the value present at "close", which gives the
  // start line of every mapping and sequence in the document.
  const starts = [];
  const listener = (eventType, state) => {
    if (eventType === 'open') {
      starts.push(state.line);
      return;
    }
    const start = starts.pop();
    const value = state.result;
    if (value !== null && typeof value === 'object' && !lines.has(value)) {
      lines.set(value, start + 1);
    }
  };
  let document;
  try {
    document = yaml.load(text, {
      // CORE_SCHEMA reads only the YAML types the format allows, so a value
      // such as a date is left as the string the author wrote.
      schema: yaml.CORE_SCHEMA,
      json: false,
      listener
    });
  } catch (error) {
    const line = error && error.mark && typeof error.mark.line === 'number'
      ? error.mark.line + 1
      : null;
    throw new ParseError(
      `the text is not valid YAML: ${error.reason || error.message}`, line);
  }
  requireMapping(document);
  requireDistinctKeys(document, lines);
  return { format: 'yaml', document, lines };
}

/**
 * Every key in the format is matched without regard to case, so two keys
 * in one mapping that differ only in case are one key written twice. A
 * YAML or JSON reader keeps both, and a reader that then matches without
 * regard to case would quietly take one and drop the other, which is the
 * failure the duplicate key rule exists to stop. So both are refused.
 */
function requireDistinctKeys(node, lines) {
  if (node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) requireDistinctKeys(item, lines);
    return;
  }
  const seen = new Map();
  for (const key of Object.keys(node)) {
    const lower = key.toLowerCase();
    if (seen.has(lower)) {
      const line = lines.get(node);
      throw new ParseError(
        `the keys '${seen.get(lower)}' and '${key}' differ only in case, ` +
        'and keys are matched without regard to case, so one of the two ' +
        'would be dropped',
        line === undefined ? null : line);
    }
    seen.set(lower, key);
    requireDistinctKeys(node[key], lines);
  }
}

function requireMapping(document) {
  if (document === null || document === undefined) {
    throw new ParseError('the script is empty', null);
  }
  if (typeof document !== 'object' || Array.isArray(document)) {
    throw new ParseError(
      'the script must be a mapping of keys to values at the top level',
      null);
  }
}

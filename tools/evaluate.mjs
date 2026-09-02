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
 * The reference evaluator. Given a validated model and the source property
 * values for one request, it produces the output value, or the reason there
 * is no output value.
 *
 * Every language implementation must agree with this file, and the
 * conformance cases in `tests/` are how that agreement is proved.
 */

/**
 * The sentence appended to every "no value" message, naming the things that
 * usually cause a source property to be missing.
 */
export const USUAL_CAUSES =
  'Usual causes are the element that supplies the property not being in ' +
  'the pipeline, the property being excluded in the engine configuration, ' +
  'the property not being included in the resource key, or JavaScript that ' +
  'populates the property not having run yet.';

/**
 * Runs one script for one request.
 *
 * @param {object} model a model from `validate.mjs`.
 * @param {object} properties a map from "element.Property" to a native
 *   value, a `{ String: "..." }` wrapper holding the string form, or a
 *   `{ NoValue: "..." }` wrapper standing for a source value that exists
 *   but carries a no value message. A property that is not a key of the
 *   map is absent.
 * @param {{trace?: boolean}} [options]
 * @returns {{value?: *, missing?: string[], message?: string,
 *   trace?: object}}
 */
export function evaluate(model, properties, options = {}) {
  const lookup = buildLookup(properties);
  const slots = model.properties.map(p => readSlot(p, lookup));

  const trace = options.trace
    ? {
      properties: model.properties.map((p, i) => ({
        name: p.name,
        available: slots[i].available,
        value: slots[i].available ? slots[i].value : undefined,
        reason: slots[i].reason
      })),
      checks: [],
      matchedRule: null,
      matchedBy: null
    }
    : null;

  // Every source property the script names is read before anything is
  // evaluated. A property is either there or it is not, and where any one
  // of them is missing the script says so rather than guessing.
  const missing = [];
  const reasons = [];
  for (let i = 0; i < model.properties.length; i++) {
    if (!slots[i].available) {
      missing.push(model.properties[i]);
      reasons.push(slots[i].reason);
    }
  }
  if (missing.length > 0) {
    const result = {
      missing: missing.map(p => p.name),
      message: missingMessage(model, missing, reasons)
    };
    if (trace) result.trace = trace;
    return result;
  }

  const state = { model, slots, checks: new Array(model.checks.length) };
  for (let i = 0; i < model.checks.length; i++) {
    state.checks[i] = evaluateCondition(model.checks[i].condition, state);
    if (trace) {
      trace.checks.push({
        name: model.checks[i].name,
        state: describeState(state.checks[i])
      });
    }
  }

  for (let i = 0; i < model.rules.length; i++) {
    const rule = model.rules[i];
    // An Else rule has no condition and always matches.
    const matched = rule.when === null || evaluateCondition(rule.when, state);
    if (matched) {
      if (trace) {
        trace.matchedRule = i;
        trace.matchedBy = rule.when === null ? 'Else' : 'When';
      }
      const result = { value: rule.value };
      if (trace) result.trace = trace;
      return result;
    }
  }

  // Every script ends in an Else, which the validator enforces, so the loop
  // above always returns. Reaching here means a model was built by hand
  // rather than by the validator.
  throw new Error(`the rules of '${model.output.Name}' do not end in an ` +
    'Else, which format 1 does not allow');
}

/** "true" or "false", for the trace and the tester page. */
export function describeState(value) {
  return value ? 'true' : 'false';
}

// ---------------------------------------------------------------------
// Reading source properties.
// ---------------------------------------------------------------------

function buildLookup(properties) {
  const lookup = new Map();
  if (properties) {
    for (const key of Object.keys(properties)) {
      lookup.set(key.toLowerCase(), properties[key]);
    }
  }
  return lookup;
}

/**
 * Reads one source property for one request, converting it to the type the
 * script inferred for it.
 *
 * @returns {{available: boolean, value: *, reason: string|null}}
 */
function readSlot(property, lookup) {
  const elementKey = property.name.slice(0, property.name.indexOf('.'));
  const propertyName = property.name.slice(property.name.indexOf('.') + 1);
  const absent = reason => ({ available: false, value: undefined, reason });
  const notAvailable = detail => absent(
    `element '${elementKey}' has no value for '${propertyName}': ${detail}`);

  if (!lookup.has(property.key)) {
    return notAvailable('property not present on this request');
  }
  let raw = lookup.get(property.key);
  if (raw === null || raw === undefined) {
    return notAvailable('property not present on this request');
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    if ('NoValue' in raw) {
      return notAvailable(String(raw.NoValue));
    }
    if ('String' in raw) {
      raw = raw.String;
      if (raw === null || raw === undefined) {
        return notAvailable('property not present on this request');
      }
    }
  }
  if (Array.isArray(raw)) {
    // A list of weighted values takes the value with the highest weight.
    // Any other list where a single value is needed is invalid.
    const weighted = raw.length > 0 && raw.every(
      m => m !== null && typeof m === 'object' && !Array.isArray(m) &&
        'Value' in m);
    if (!weighted) {
      return absent(`held a list where a single value is needed`);
    }
    let best = raw[0];
    for (const member of raw) {
      if ((member.Weight ?? 0) > (best.Weight ?? 0)) best = member;
    }
    raw = best.Value;
    if (raw === null || raw === undefined) {
      return notAvailable('property not present on this request');
    }
  }

  const converted = convertValue(raw, property.type);
  if (!converted.ok) {
    return absent(
      `held '${displayRaw(raw)}' which cannot be read as ${property.type}`);
  }
  return { available: true, value: converted.value, reason: null };
}

function displayRaw(raw) {
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'boolean') return raw ? 'True' : 'False';
  return String(raw);
}

/** The largest and smallest values the type `int` holds. */
export const INT_MIN = -2147483648;
/** The largest value the type `int` holds. */
export const INT_MAX = 2147483647;

/**
 * Whether a number is a whole number the type `int` can hold.
 *
 * The format fixes `int` at a signed 32 bit whole number, which is what
 * the type is called in .NET and in Java, so that one script gives one
 * answer everywhere. JavaScript has a single number type and would
 * otherwise carry whole numbers up to 2 to the power 53, and a value
 * between the two limits would then be readable in JavaScript and
 * unreadable in .NET, which changes the answer rather than only the
 * wording of a message.
 */
function isInt32(value) {
  return Number.isInteger(value) && value >= INT_MIN && value <= INT_MAX;
}

/**
 * Converts a source value, which arrives either as the native type or as a
 * string, to the type the script inferred.
 *
 * @returns {{ok: boolean, value?: *}}
 */
export function convertValue(raw, type) {
  if (typeof raw === 'string') return convertString(raw, type);
  switch (type) {
    case 'bool':
      return typeof raw === 'boolean' ? { ok: true, value: raw } : { ok: false };
    case 'int':
      if (typeof raw === 'bigint') {
        return raw >= -2147483648n && raw <= 2147483647n
          ? { ok: true, value: Number(raw) }
          : { ok: false };
      }
      return typeof raw === 'number' && isInt32(raw)
        ? { ok: true, value: raw }
        : { ok: false };
    case 'double':
      if (typeof raw === 'bigint') return { ok: true, value: Number(raw) };
      return typeof raw === 'number' && Number.isFinite(raw)
        ? { ok: true, value: raw }
        : { ok: false };
    case 'string':
      if (typeof raw === 'boolean') {
        return { ok: true, value: raw ? 'True' : 'False' };
      }
      if (typeof raw === 'number' || typeof raw === 'bigint') {
        return { ok: true, value: String(raw) };
      }
      return { ok: false };
    default:
      return { ok: false };
  }
}

/**
 * Converts the string form of a value to the type given. Values are never
 * coerced loosely, so `N/A`, `Unknown` and an empty string never become
 * false or zero.
 *
 * @returns {{ok: boolean, value?: *}}
 */
export function convertString(raw, type) {
  if (typeof raw !== 'string') return { ok: false };
  switch (type) {
    case 'bool': {
      const trimmed = raw.trim().toLowerCase();
      if (trimmed === 'true') return { ok: true, value: true };
      if (trimmed === 'false') return { ok: true, value: false };
      return { ok: false };
    }
    case 'int': {
      const trimmed = raw.trim();
      if (!/^[+-]?\d+$/.test(trimmed)) return { ok: false };
      const value = Number(trimmed);
      return isInt32(value) ? { ok: true, value } : { ok: false };
    }
    case 'double': {
      const trimmed = raw.trim();
      if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(trimmed)) {
        return { ok: false };
      }
      const value = Number(trimmed);
      return Number.isFinite(value) ? { ok: true, value } : { ok: false };
    }
    case 'string':
      return { ok: true, value: raw };
    default:
      return { ok: false };
  }
}

// ---------------------------------------------------------------------
// Conditions.
// ---------------------------------------------------------------------

/**
 * Every condition is true or false, because the rules only run once every
 * source property the script names has been read.
 */
function evaluateCondition(condition, state) {
  switch (condition.kind) {
    case 'compare': {
      const slot = state.slots[condition.slot];
      return compare(slot.value, condition.op, condition.operand,
        condition.type);
    }
    case 'check':
      return state.checks[condition.index];
    case 'aggregate':
      return compare(countOf(condition.agg, condition.group, state),
        condition.op, condition.operand, 'int');
    case 'all':
      return condition.items.every(item => evaluateCondition(item, state));
    case 'any':
      return condition.items.some(item => evaluateCondition(item, state));
    case 'not':
      return !evaluateCondition(condition.item, state);
    default:
      throw new Error(`unknown condition kind '${condition.kind}'`);
  }
}

/**
 * Counts checks in a group. A null group means every named check. Every
 * check is true or false, so Passed and Failed always add up to the size of
 * the group.
 */
function countOf(agg, group, state) {
  const indexes = group === null
    ? state.checks.map((_, i) => i)
    : group;
  let count = 0;
  for (const index of indexes) {
    const value = state.checks[index];
    if (agg === 'Passed' && value === true) count++;
    else if (agg === 'Failed' && value === false) count++;
  }
  return count;
}

function compare(left, op, right, type) {
  switch (op) {
    case 'Eq': return left === right;
    case 'Ne': return left !== right;
    case 'Gt': return left > right;
    case 'Ge': return left >= right;
    case 'Lt': return left < right;
    case 'Le': return left <= right;
    case 'In': return right.some(member => member === left);
    case 'NotIn': return !right.some(member => member === left);
    case 'StartsWith': return left.startsWith(right);
    case 'EndsWith': return left.endsWith(right);
    case 'Contains': return left.includes(right);
    default:
      throw new Error(`unknown operator '${op}' on type ${type}`);
  }
}

// ---------------------------------------------------------------------
// Messages.
// ---------------------------------------------------------------------

function missingMessage(model, missing, reasons) {
  const count = missing.length;
  const noun = count === 1
    ? '1 source property was not available'
    : `${count} source properties were not available`;
  const details = missing
    .map((p, i) => `'${p.name}' (${reasons[i]}).`)
    .join(' ');
  return `Derived property '${model.output.Name}' has no value because ` +
    `${noun}. ${details} ${USUAL_CAUSES}`;
}

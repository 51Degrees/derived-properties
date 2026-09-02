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
 * Runs every script in `scripts/` against its cases in `tests/`, runs every
 * script in `tests/invalid/` that must be rejected, and reports rule and
 * value coverage. A rule no case reaches is a failure and a declared output
 * value no case returns is a notice. Exits non zero on any failure.
 *
 * Usage: node tools/run-cases.mjs [repository root]
 */

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, basename, extname, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from './parse.mjs';
import { validateText, faultsMessage } from './validate.mjs';
import { evaluate } from './evaluate.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Loads and validates every script in `scripts/`. */
export function loadScripts(root) {
  const folder = join(root, 'scripts');
  const scripts = [];
  if (!existsSync(folder)) return scripts;
  for (const file of readdirSync(folder).sort()) {
    if (!/\.(ya?ml|json)$/i.test(file)) continue;
    const path = join(folder, file);
    const name = basename(file, extname(file));
    const text = readFileSync(path, 'utf8');
    const { model, faults } = validateText(text, { name, source: path });
    scripts.push({ name, path, text, model, faults });
  }
  return scripts;
}

/** Reads a cases file, which is always YAML. */
function readCases(path) {
  return parse(readFileSync(path, 'utf8')).document;
}

function runScriptCases(script, casesPath, report) {
  const document = readCases(casesPath);
  const scriptName = document.Script ?? document.script;
  if (scriptName !== script.name) {
    report.fail(`${basename(casesPath)}: Script is '${scriptName}' but the ` +
      `file is for '${script.name}'`);
    return;
  }
  const cases = document.Cases ?? document.cases;
  if (!Array.isArray(cases) || cases.length === 0) {
    report.fail(`${basename(casesPath)}: Cases must list at least one case`);
    return;
  }
  for (const testCase of cases) {
    const name = testCase.Name ?? '(unnamed)';
    const properties = testCase.Properties ?? {};
    const expect = testCase.Expect;
    if (expect === undefined) {
      report.fail(`${script.name}: '${name}' has no Expect`);
      continue;
    }
    const result = evaluate(script.model, properties, { trace: true });
    // Record which rule the case reached, for the coverage check.
    if (result.trace && result.trace.matchedRule !== null) {
      report.rulesReached(script.name).add(result.trace.matchedRule);
    }
    if (result.value !== undefined) {
      report.valuesReached(script.name).add(String(result.value));
    }

    if ('Value' in expect) {
      if (result.value === undefined) {
        report.fail(`${script.name}: '${name}' expected the value ` +
          `'${expect.Value}' but there was no value. ${result.message}`);
      } else if (String(result.value) !== String(expect.Value)) {
        report.fail(`${script.name}: '${name}' expected '${expect.Value}' ` +
          `but got '${result.value}'`);
      } else {
        report.pass();
      }
      continue;
    }
    if ('Missing' in expect) {
      const expected = [...expect.Missing].map(s => s.toLowerCase()).sort();
      const actual = (result.missing ?? []).map(s => s.toLowerCase()).sort();
      if (actual.length === 0) {
        report.fail(`${script.name}: '${name}' expected a missing value ` +
          `naming ${expected.join(', ')} but got '${result.value}'`);
      } else if (JSON.stringify(expected) !== JSON.stringify(actual)) {
        report.fail(`${script.name}: '${name}' expected the missing ` +
          `properties ${expected.join(', ')} but got ${actual.join(', ')}`);
      } else {
        report.pass();
      }
      continue;
    }
    report.fail(`${script.name}: '${name}' has an Expect that is not ` +
      'Value or Missing');
  }
}

function runInvalidCases(root, report) {
  const folder = join(root, 'tests', 'invalid');
  if (!existsSync(folder)) {
    report.notice('tests/invalid is missing, so no rejection cases were run');
    return;
  }
  const files = readdirSync(folder).filter(f => /\.ya?ml$/i.test(f)).sort();
  if (files.length === 0) {
    report.notice('tests/invalid is empty, so no rejection cases were run');
    return;
  }
  for (const file of files) {
    const path = join(folder, file);
    const document = parse(readFileSync(path, 'utf8')).document;
    const scriptText = document.Script;
    const expect = document.Expect ?? {};
    if (typeof scriptText !== 'string') {
      report.fail(`${file}: Script must be the text of the script to reject`);
      continue;
    }
    const { model, faults } = validateText(scriptText, {
      name: document.Name ?? null, source: file
    });
    if (model !== null) {
      report.fail(`${file}: the script was expected to be rejected but it ` +
        'validated');
      continue;
    }
    let ok = true;
    for (const path of expect.Paths ?? []) {
      if (!faults.some(f => f.path === path)) {
        ok = false;
        report.fail(`${file}: expected a fault at '${path}'. Faults were:\n` +
          faultsMessage(faults));
      }
    }
    for (const fragment of expect.Mentions ?? []) {
      if (!faults.some(f => f.message.includes(fragment))) {
        ok = false;
        report.fail(`${file}: expected a fault mentioning '${fragment}'. ` +
          `Faults were:\n${faultsMessage(faults)}`);
      }
    }
    if (ok) report.pass();
  }
}

/**
 * Rule coverage and declared value coverage, which are held to different
 * standards on purpose.
 *
 * A rule no case reaches is a failure, because nothing proves what that
 * rule does. A declared value no case returns is a notice rather than a
 * failure, because a value can be declared that no rule can return,
 * usually where the rules were narrowed and the value list was not, and
 * no case can then be written for that value. Whether to drop the value
 * or to add a rule that returns it is a judgement, so the notice puts the
 * question in front of a reviewer instead of blocking the run.
 */
function checkCoverage(script, report) {
  const rules = report.rulesReached(script.name);
  const uncovered = [];
  for (let i = 0; i < script.model.rules.length; i++) {
    if (!rules.has(i)) uncovered.push(i);
  }
  if (uncovered.length > 0) {
    report.fail(`${script.name}: no case reaches ${uncovered.length} of the ` +
      `${script.model.rules.length} rules, being ` +
      uncovered.map(i => `Rules[${i}]`).join(', '));
  }

  const values = script.model.output.Values;
  const declared = values === null || values === undefined
    ? []
    : values.map(v => String(v.Name));
  const reached = report.valuesReached(script.name);
  const missed = declared.filter(v => !reached.has(v));
  if (missed.length > 0) {
    report.notice(`${script.name}: no case returns ` +
      `${missed.length === 1 ? 'the declared value' : 'the declared values'} ` +
      `${missed.join(', ')}. A value that no rule can return is worth a ` +
      'reviewer looking at, because a customer reads it in the property ' +
      'metadata whilst nothing produces it');
  }

  return {
    rules: `${script.model.rules.length - uncovered.length}/` +
      `${script.model.rules.length}`,
    values: declared.length === 0
      ? 'n/a'
      : `${declared.length - missed.length}/${declared.length}`
  };
}

class Report {
  constructor() {
    this.passed = 0;
    this.failures = [];
    this.notices = [];
    this.rules = new Map();
    this.values = new Map();
  }

  pass() { this.passed++; }
  fail(message) { this.failures.push(message); }
  notice(message) { this.notices.push(message); }

  rulesReached(name) {
    if (!this.rules.has(name)) this.rules.set(name, new Set());
    return this.rules.get(name);
  }

  valuesReached(name) {
    if (!this.values.has(name)) this.values.set(name, new Set());
    return this.values.get(name);
  }
}

/**
 * Runs everything and returns the report.
 *
 * @param {string} root the repository root.
 */
export function run(root) {
  const report = new Report();
  const scripts = loadScripts(root);
  const rows = [];

  if (scripts.length === 0) {
    report.notice('scripts/ holds no scripts, so no cases were run');
  }

  const names = new Set();
  for (const script of scripts) {
    if (script.faults.length > 0) {
      report.fail(`${script.name} does not validate:\n` +
        faultsMessage(script.faults));
      continue;
    }
    const outputName = script.model.output.Name;
    if (names.has(outputName)) {
      report.fail(`two scripts produce the output property '${outputName}'`);
    }
    names.add(outputName);
    if (script.name !== script.model.name) {
      report.fail(`${script.name}: Name is '${script.model.name}'`);
    }

    const casesPath = join(root, 'tests', `${script.name}.cases.yaml`);
    if (!existsSync(casesPath)) {
      report.fail(`${script.name}: there is no tests/${script.name}.cases.yaml`);
      continue;
    }
    runScriptCases(script, casesPath, report);
    const coverage = checkCoverage(script, report);
    rows.push({
      Script: script.name,
      Version: script.model.version,
      Output: outputName,
      Type: script.model.output.ValueType,
      Rules: coverage.rules,
      Values: coverage.values
    });
  }

  runInvalidCases(root, report);
  report.rows = rows;
  return report;
}

function main() {
  const root = process.argv[2]
    ? resolve(process.argv[2])
    : resolve(HERE, '..');
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    console.error(`'${root}' is not a folder`);
    process.exit(2);
  }
  const report = run(root);

  if (report.rows.length > 0) {
    console.table(report.rows);
  }
  for (const notice of report.notices) {
    console.log(`notice: ${notice}`);
  }
  for (const failure of report.failures) {
    console.error(`FAIL ${failure}`);
  }
  console.log(`${report.passed} passed, ${report.failures.length} failed`);
  process.exit(report.failures.length === 0 ? 0 : 1);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(HERE, 'run-cases.mjs')) {
  main();
}

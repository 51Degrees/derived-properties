# Writing and running cases

Every script in this repository is proved by cases, and every 51Degrees
language implementation runs the same case files, so a case written here
becomes a test in each language as that language is built, starting with
.NET and followed by Node, Java, Python and PHP.
[Authoring a script](authoring.md) takes a
new script from a blank file to a passing case, and this page covers the
case files themselves, the rejection cases, the comparison against the
51Degrees property metadata, the coverage rule and the tester page.

Three kinds of test live in the repository.

| Where | What is proved |
| --- | --- |
| `tests/<Name>.cases.yaml` | One script gives the expected answer for a request |
| `tests/invalid/*.yaml` | A script that breaks a rule of the format is rejected, with a useful message |
| `tools/test/*.test.mjs` | The reference parser, validator, evaluator and canonical printer behave as [format 1](format-1.md) says |

Anyone adding or changing a script writes the first kind. Anyone changing
the tools in `tools/` writes the third kind as well.

## Running the checks on your own machine

[Node.js](https://nodejs.org) is the only thing needed, and
`tools/package.json` asks for version 20 or later. The transcripts below
were taken on Node v24.13.0 with npm 11.6.2, and the counts they carry
move every time a script, a case or a unit test is added, so read the
shape of each transcript rather than its numbers.

Install the one dependency of the tools, which is
[js-yaml](https://github.com/nodeca/js-yaml).

```text
cd tools
npm install
```

```text
added 7 packages, and audited 8 packages in 4s

3 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities
```

Run the unit tests of the tools, still from `tools`.

```text
node --test test/*.test.mjs
```

```text
✔ YAML and the JSON that mirrors it print the same canonical JSON (10.2118ms)
✔ the canonical form prints two space indent and PascalCase keys (1.4237ms)
...
✔ a JSON script and the YAML it mirrors validate to the same model (0.7387ms)
ℹ tests 165
ℹ suites 0
ℹ pass 165
ℹ fail 0
```

The middle of the transcript above, one line per test, has been cut out
where the three dots are, and so are the timing lines at the end. Keep the
quotation marks around the pattern so that Node receives the pattern and
expands it, because PowerShell and the Windows command prompt do not
expand a pattern themselves. A shell that does expand a pattern, such as
bash, gives the same result either way. An older Node that reports it
cannot find `test/*.test.mjs` needs the file names listed instead.

Run every case, from the root of the repository rather than from `tools`.

```text
node tools/run-cases.mjs
```

```text
┌─────────┬───────────────────┬─────────┬───────────────────┬──────────┬───────┬────────┐
│ (index) │ Script            │ Version │ Output            │ Type     │ Rules │ Values │
├─────────┼───────────────────┼─────────┼───────────────────┼──────────┼───────┼────────┤
│ 0       │ 'HumanConfidence' │ '0.2.0' │ 'HumanConfidence' │ 'string' │ '4/4' │ '3/3'  │
└─────────┴───────────────────┴─────────┴───────────────────┴──────────┴───────┴────────┘
43 passed, 0 failed
```

The table carries one row for each script in `scripts/`. A line beginning
`notice:` is worth reading and does not fail the run, whilst a line
beginning `FAIL` does. The run above raised neither kind of line, and
what raises a `notice:` line is covered under the coverage rule further
down.

One run does four things, being validating every script in `scripts/`,
running every case in `tests/`, running every rejection case in
`tests/invalid/`, and reporting how much of each script the cases reached.
The pair of counts on the last line covers the script cases and the
rejection cases together rather than the unit tests of the tools. The
command exits with a status of 1 when anything failed, which is what the
pull request check reads.

## Where a property's metadata comes from

There is no separate metadata check to run, because there is nothing to
check it against. A script's `Output` block **is** the definition of its
property, holding the description, the value type and the value list a
customer reads. It is not a copy of a definition kept somewhere else, and
no second copy is kept anywhere.

So the only thing that has to be right about `Output` is that it
validates, which
[`tools/test/schema.test.mjs`](../tools/test/schema.test.mjs) and
[`tools/validate.mjs`](../tools/validate.mjs) between them cover. Getting
the description right is a matter of review rather than of comparison,
and [`docs/authoring.md`](authoring.md) says what a good one looks like.

## Writing a cases file

A cases file is named after the script, so `scripts/BrowserCurrency.yaml`
is proved by `tests/BrowserCurrency.cases.yaml`. A script with no cases
file fails the run.

```yaml
Script: BrowserCurrency
Cases:
  - Name: a browser released three months ago
    Properties:
      device.BrowserReleaseYear: 2026
      device.BrowserReleaseAge: 3
    Expect: { Value: Current }
```

`Script` names the script the file proves, and the name must equal the
`Name` of that script. `Cases` is a list of at least one case, and each
case carries the following three keys.

`Name` says what the request represents. The name appears in the failure
message, so write the situation rather than the mechanics, for example "a
first request before JavaScript has run" rather than "case 4".

`Properties` is the request. Each key is a source property written as
`elementDataKey.PropertyName`, and each value is one of the forms in the
table below. **A property that is not listed is absent**, which is how a
case says that an element was not in the pipeline, or that a property was
left out of the resource key, or that the client side JavaScript has not
run yet.

| Form | Example | What arrives |
| --- | --- | --- |
| A native value | `device.IsCrawler: false` | The value with the type as written, being a boolean, a whole number, a decimal number or text |
| `{ String: "..." }` | `device.IsCrawler: { String: "False" }` | The string form of the value, which is how a value read from a data file or a cloud response usually arrives |
| `{ NoValue: "..." }` | `device.IsCrawler: { NoValue: "The JavaScript has not run yet." }` | A source value that exists but carries a no value message, being the text given. The property counts as absent and the text is repeated in the message the output carries |
| A list of `{ Value, Weight }` | see below | A weighted list, where the value with the highest weight is the one the script reads |
| Not listed at all | | The property is absent |

```yaml
    Properties:
      ip.HumanProbability:
        - { Value: 9, Weight: 0.7 }
        - { Value: 3, Weight: 0.3 }
```

Write both the native form and the string form. A script that passes
with native values and fails with the string forms is a script that will
behave differently between a data file, the cloud and a customer's own
element, so write both for at least one request. Add the values that mean
nothing as well, being `N/A`, `Unknown` and the empty string, because none
of those ever becomes false or zero and a case is the only thing that
proves the script treats each one as making the property absent.

`Expect` is what the script must produce, in one of two forms, because a
script has exactly two outcomes.

| Form | Meaning |
| --- | --- |
| `{ Value: Current }` | The script produces this value. Comparison is on the text of the value, so `{ Value: 3 }` and `{ Value: "3" }` both suit a whole number output |
| `{ Missing: [device.IsCrawler] }` | The script produces no value at all, because the properties listed could not be read. Order does not matter and letter case is ignored. Every property that could not be read has to be listed, so a case naming one of two unreadable properties fails |

A property lands in `Missing` whenever the script could not read it,
which covers the property not being in the flow data, the property
carrying a no value message of its own, and the value being there but not
converting to the type the script inferred. All three are the same
outcome to a customer, so all three are written the same way here.

The failure line carries the case name, the value the case expected and
the value that came back. The `AgeBand` script in the line below was
written to produce the message and is not one of the scripts in the
repository.

```text
FAIL AgeBand: 'deliberately wrong, to see the failure message' expected 'Ancient' but got 'New'
```

## Writing a rejection case

`tests/invalid/` holds scripts that every implementation must refuse,
along with what each refusal has to say. Each file is numbered so that the
folder reads in the order of the fault list in the format reference, for
example `09-unknown-operator.yaml`.

```yaml
# Equals is a reasonable guess at the name and is not one of the operators,
# so the message lists the ones that are.
Script: |
  Format: 1
  Name: Broken
  Version: 1.0.0
  Output:
    Name: Broken
    Description: An output.
    ValueType: string
    IsList: false
  Rules:
    - When: { Property: device.IsCrawler, Equals: false }
      Then: High
    - Else: Low
Expect:
  Paths: [ "Rules[0].When" ]
  Mentions: [ "unknown operator 'Equals'" ]
```

`Script` is the whole text of the script to reject, written as a YAML
block with the `|` marker so that every line is kept exactly as typed.

`Name` is optional and gives the file name, without its extension, that
the script is treated as having. Only a case about the rule that a script
name must equal its file name needs `Name`, and
`tests/invalid/06-name-not-the-file-name.yaml` is the one such case.

`Expect.Paths` lists places in the document where a fault must be
reported, written the way the validator writes a path, for example
`Rules[0].When` or `Output.ValueType` or `Checks.Current.All[1]`. Each
path listed has to carry a fault of its own.

`Expect.Mentions` lists fragments of text that must appear in a fault
message. A fragment is the part of the message that tells the author what
to do, so quote the operator, the property or the value the message
names rather than the whole sentence, which leaves the wording free to
improve.

A rejection case fails in one of two ways. Either the script validated
when the case said the script must not, or a path or a fragment was not
found, in which case every fault that was raised is printed so the
expectation can be corrected. The case in the line below was written to
produce the message, by expecting the fault one rule further down than
the place the fault was actually reported.

```text
FAIL 99-demo.yaml: expected a fault at 'Rules[1].When'. Faults were:
script (99-demo.yaml) line 10 at Rules[0].When: unknown operator 'Equals', expected one of Eq, Ne, Gt, Ge, Lt, Le, In, NotIn, StartsWith, EndsWith, Contains
```

## The coverage rule

The `Rules` and `Values` columns of the table show how far the cases got,
as a count of what was reached over the count of what exists. A script
with no `Values` list shows `n/a` in the `Values` column. The two columns
are held to different standards on purpose.

**Every rule must be reached by at least one case, and a rule no case
reaches fails the run.** Nothing proves what an unreached rule does. The
`BrowserCurrency` script in the line below is the worked example of
[Authoring a script](authoring.md), part way through, with one of its two
rules covered.

```text
FAIL BrowserCurrency: no case reaches 1 of the 2 rules, being Rules[1]
```

Rules are numbered from zero in the order the script writes them, so
`Rules[1]` is the second entry under `Rules`. A rule that no case reaches
is either a rule the script does not need or a situation nobody has
written down yet, and both are worth settling before a reviewer reads the
pull request.

**A value under `Output.Values` that no case returns raises a notice
rather than a failure.** A value can be declared that no rule of the
script can return, usually because the rules were narrowed and the value
list was not, and no case can then be written for that value. Whether to
drop the value or to add a rule that returns it is a judgement, so the
notice puts the question in front of a reviewer instead of blocking the
run.

No script in `scripts/` raises the notice today. The line below comes
from the `BrowserCurrency` worked example of
[Authoring a script](authoring.md), part way through, where the `Else`
can return `Dated` and no case has asked it to yet.

```text
notice: BrowserCurrency: no case returns the declared value Dated. A value that no rule can return is worth a reviewer looking at, because a customer reads it in the property metadata whilst nothing produces it
```

Where a rule can return the value, as the `Else` can return `Dated` here,
a case that returns the value is expected, so treat the notice as
something to answer rather than something to live with.

Coverage counts the rule that matched and the value that came back. A case
whose `Expect` is `{ Missing: [...] }` reaches no rule at all, because
every source property is read before any rule runs, so a script needs
cases that produce values as well as cases that produce a missing value.

## The tester page

`site/index.html` is a page for trying a script by hand, and the page
loads `tools/parse.mjs`, `tools/validate.mjs`, `tools/evaluate.mjs` and
`tools/canonical.mjs` without altering any of them, so an answer on the
page is the answer the cases give. Everything runs in the browser and
nothing typed into the page is sent anywhere.

Browsers refuse to load JavaScript modules from a `file://` address, so
serve the repository rather than opening the file. From the root of the
repository, with [Python](https://www.python.org) installed, the following
works.

```text
python -m http.server 8123
```

Then open `http://127.0.0.1:8123/site/index.html`. Once 51Degrees
publishes the repository through
[GitHub Pages](https://docs.github.com/pages), the same page is reachable
without anyone installing anything.

The page has two boxes and a Run button. The left box takes the script, as
YAML or as JSON, and the Load HumanConfidence button fills the box from
`scripts/HumanConfidence.yaml`. The right box takes the request, written
as a YAML mapping in exactly the shape a case uses, so a block can be
copied straight out of a cases file.

```yaml
device.IsCrawler: false
device.BrowserReleaseYear: 2026
device.BrowserReleaseAge: 1
ip.HumanProbability: 9
```

Pressing Run reports the following, in order.

1. **Validation.** Either the faults, each with the path, the line and the
   message, or a line saying what the script produces and how many source
   properties, checks and rules the script holds.
2. **Result.** The value, or the message saying which properties could not
   be read.
3. **Trace.** A table of the source properties showing whether each one
   was read and why a property was not, then a table of the checks showing
   passed or failed for each one, then the rule that matched and the
   clause that matched it.
4. **Canonical JSON of the compiled model**, folded away until opened,
   being the same text a language package writes to its debug log when the
   pipeline is built.

The trace is the quickest way to answer the question a set of rules raises
most often, which is why a request came out Medium rather than High.
Delete a property from the request box and the page shows the no value
message instead of a value, naming the property that was taken out, which
is the other half of what a script can do. Once the page shows why, write
the request down as a case so that the answer stays proved.

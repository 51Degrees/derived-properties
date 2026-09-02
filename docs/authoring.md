# Authoring a script

A script is one [YAML](https://yaml.org) or JSON file describing how one
output property is worked out from properties that other elements in a
51Degrees Pipeline have already produced. Every key, every operator and
every rule about types is defined in [format 1](format-1.md), which is the
reference to reach for when a question is about what the format allows.
This page is the practical route from a blank file to a pull request, and
where format 1 and this page disagree, format 1 wins.

The transcripts below are output from the tools in this repository, with
three things trimmed so the lines fit the page and stay true as the
repository grows. The folders in front of a file name are shortened, the
rows for the scripts already in `scripts/` are left out of the table
because those rows say nothing about the example, and the totals line at
the end of a run is left out because the totals move every time a script
or a case is added.

## The one rule to hold on to

A script names source properties inside its conditions. Where every one
of those properties is available on a request, the checks and the rules
run and a value is chosen. Where any one of them is not available, the
script produces no value and the message names each property that was
missing along with what its source element said about it.

That is the whole of the behaviour, and two things follow from it that
shape how a script is written.

**Naming a property makes it necessary.** There is no way to mark a
property as one the script can manage without, so a script that names a
property no pipeline supplies produces no value for every single request.
Name only the properties the script genuinely needs, and add a property
to a script once the property is in the data rather than before.

**A value nobody could read is honest silence rather than a guess.** A
request where a source property cannot be read gives the customer a
message naming that property, which carries more information than a
middling value would.

## What a script may do, and what belongs somewhere else

A script turns property values into another property value by rules. That
is the whole of the scope. The element holds no data file, makes no
request, keeps nothing between requests and reads no evidence, so a script
cannot do any of those things either.

The format is deliberately small. It is for properties that follow simply
from properties already in the flow data, and it is not a programming
language. Work that needs any of the following is a flow element of your
own written in code, which is how such work is done today and is not a
lesser route.

- A network call, a database read or a file read while the request runs.
- State carried from one request to the next, such as a count per session
  or a cache.
- Reading evidence, meaning the HTTP headers, query string, cookies or
  client side values that arrive with the request. A script only sees
  properties that an element earlier in the pipeline has already
  published.
- Producing more than one property from one file. One script produces one
  property, and a second property means a second script.
- Anything whose rules are becoming hard to read. A script nobody can
  follow at a glance has outgrown the format.

Writing a flow element is documented under
[Custom Flow Elements](https://51degrees.com/documentation/_pipeline_api__features__custom_elements.html),
which covers the base classes and the pipeline registration in each
language.

## A worked example, from a blank file to a passing case

The example on this page is `BrowserCurrency`, a small property that says
whether the browser making the request is a recent release.
`BrowserCurrency` was written for this page and is not one of the scripts
in `scripts/`. The script that ships is `HumanConfidence.yaml`, and
reading that file alongside this page is worth the few minutes.

Two source properties carry the example.

| Source property | Type | What the property holds |
| --- | --- | --- |
| `device.BrowserReleaseYear` | int | The year the browser was released. An unmatched browser gives the string `Unknown`, which cannot be read as a whole number |
| `device.BrowserReleaseAge` | int | Months since the browser was released. An unmatched browser gives 0 |

The first of the two carries more weight than it looks. Because the
script names `device.BrowserReleaseYear`, a request whose browser was not
matched has no value for `BrowserCurrency` at all, and the customer reads
a message naming that property rather than a band worked out from an age
of 0 months that means nothing.

### Step 1, the Output block

Start the file with the four keys that identify the script and the block
that defines the property, being `Format`, `Name`, `Version` and `Output`.
The file name without its extension must equal `Name`, so this file is
`scripts/BrowserCurrency.yaml`.

```yaml
Format: 1
Name: BrowserCurrency
Version: 0.1.0
Output:
  Name: BrowserCurrency
  Description: Whether the browser making the request is a recent release. Returns Current where the browser was released in the last twelve months and Dated where it was released earlier. There is no value where the browser release date could not be read.
  ValueType: string
  IsList: false
  IsMandatory: true
  Category: General
  Values:
    - Name: Current
      Description: The browser was released in the last twelve months.
    - Name: Dated
      Description: The browser was released more than twelve months ago.
```

`Output` uses the field names and the meanings 51Degrees uses for the
metadata of every property, and it is the one definition of the property,
so a script that 51Degrees later takes into a product is read as it
stands and nobody rewrites the metadata anywhere else. Every value the
rules can return is listed under `Values` with a description of its own.

There is no `Unknown` value in the list, and no `DefaultValue` either. A
request the script cannot answer has no value and a message saying why,
so there is nothing for a third value to stand for. `DefaultValue` is
carried into the property metadata where a script gives it, and nothing
reads it while a request is being processed, so writing one here would
suggest a fallback that does not exist.

Run the checks from the root of the repository.

```text
node tools/run-cases.mjs
```

```text
FAIL BrowserCurrency does not validate:
BrowserCurrency (scripts/BrowserCurrency.yaml) line 1 at Rules: required key 'Rules' is missing
```

A script with no rules can never produce a value, so the validator refuses
the file. Every fault carries the script name, where the script came from,
the line and the place in the document, which is `Rules` here.

### Step 2, the first check and the first rule

A check is a named test that comes out true or false. Name the first
check for what a passing test means rather than for the property being
read, because the rules read better afterwards.

```yaml
Checks:
  Known: { Property: device.BrowserReleaseYear, Gt: 0 }
Rules:
  - Else: Dated
```

Two things are worth saying about the block above.

Naming `device.BrowserReleaseYear` inside the check is what tells the
element to read that property, and there is no separate list of source
properties to keep in step. The properties a script reads are exactly the
properties its conditions name.

**The last rule must be an `Else`.** An `Else` has no condition and always
matches, so a script that has read its source properties always chooses a
value. A `Rules` list whose last entry is not an `Else` is a fault, which
is how the format guarantees that there is no third outcome beyond a
value and a missing value.

```text
node tools/run-cases.mjs
```

```text
FAIL BrowserCurrency: there is no tests/BrowserCurrency.cases.yaml
```

The script now validates, and the checks move on to complain that nothing
proves the script works.

### Step 3, the rest of the checks and rules

```yaml
Checks:
  Known:  { Property: device.BrowserReleaseYear, Gt: 0 }
  Recent: { Property: device.BrowserReleaseAge,  Lt: 12 }
Rules:
  - When: { Failed: Checks, Eq: 0 }
    Then: Current
  - Else: Dated
```

The second check brings the second source property with it, and the rule
now asks that no check failed rather than naming either check on its own.
`Passed` and `Failed` count the checks in the group, and because every
check comes out true or false the two counts always add up to the number
of checks, so `{ Failed: Checks, Eq: 0 }` and
`{ Passed: Checks, Eq: 2 }` say the same thing here.

Rules run in order and the first rule whose `When` is true supplies the
value, so the order carries as much meaning as the conditions do.

### Step 4, the cases file

Cases live in `tests/<Name>.cases.yaml`, one file per script, and every
language implementation runs the same file. Start with the two cases that
matter most, being the one a customer will see every day and the one
where a property cannot be read.

```yaml
Script: BrowserCurrency
Cases:

  - Name: a browser released three months ago
    Properties:
      device.BrowserReleaseYear: 2026
      device.BrowserReleaseAge: 3
    Expect: { Value: Current }

  - Name: an unmatched browser, where the year cannot be read
    Properties:
      device.BrowserReleaseYear: { String: "Unknown" }
      device.BrowserReleaseAge: 0
    Expect: { Missing: [ device.BrowserReleaseYear ] }
```

```text
node tools/run-cases.mjs
```

```text
┌─────────┬───────────────────┬─────────┬───────────────────┬──────────┬───────┬────────┐
│ (index) │ Script            │ Version │ Output            │ Type     │ Rules │ Values │
├─────────┼───────────────────┼─────────┼───────────────────┼──────────┼───────┼────────┤
│ 0       │ 'BrowserCurrency' │ '0.1.0' │ 'BrowserCurrency' │ 'string' │ '1/2' │ '1/2'  │
└─────────┴───────────────────┴─────────┴───────────────────┴──────────┴───────┴────────┘
notice: BrowserCurrency: no case returns the declared value Dated. A value that no rule can return is worth a reviewer looking at, because a customer reads it in the property metadata whilst nothing produces it
FAIL BrowserCurrency: no case reaches 1 of the 2 rules, being Rules[1]
```

Both cases pass, and the run still fails. Every rule has to be reached by
at least one case, and the `Rules` and `Values` columns of the table show
how far the cases got. The second case reaches no rule at all, because a
request that cannot be read never gets as far as the rules.

The `Dated` line is a notice rather than a failure, because a value can
be declared in the metadata that no rule of a script can return. Here the
`Else` can return `Dated` and no case has asked it to, so the notice and
the failure are pointing at the same missing case.

### Step 5, a complete cases file

```yaml
Script: BrowserCurrency
Cases:

  - Name: a browser released three months ago
    Properties:
      device.BrowserReleaseYear: 2026
      device.BrowserReleaseAge: 3
    Expect: { Value: Current }

  - Name: a browser released four years ago
    Properties:
      device.BrowserReleaseYear: 2022
      device.BrowserReleaseAge: 48
    Expect: { Value: Dated }

  - Name: an unmatched browser, where the year cannot be read
    Properties:
      device.BrowserReleaseYear: { String: "Unknown" }
      device.BrowserReleaseAge: 0
    Expect: { Missing: [ device.BrowserReleaseYear ] }

  - Name: neither property is in the pipeline
    Properties: {}
    Expect:
      Missing: [ device.BrowserReleaseYear, device.BrowserReleaseAge ]

  - Name: the same recent browser with both values in their string form
    Properties:
      device.BrowserReleaseYear: { String: "2026" }
      device.BrowserReleaseAge: { String: "3" }
    Expect: { Value: Current }
```

```text
node tools/run-cases.mjs
```

```text
┌─────────┬───────────────────┬─────────┬───────────────────┬──────────┬───────┬────────┐
│ (index) │ Script            │ Version │ Output            │ Type     │ Rules │ Values │
├─────────┼───────────────────┼─────────┼───────────────────┼──────────┼───────┼────────┤
│ 0       │ 'BrowserCurrency' │ '0.1.0' │ 'BrowserCurrency' │ 'string' │ '2/2' │ '2/2'  │
└─────────┴───────────────────┴─────────┴───────────────────┴──────────┴───────┴────────┘
```

Note the fourth case, where the request carries nothing at all. Both
properties are missing and both have to be listed, because a case naming
one of two missing properties fails.

The script is now ready for a pull request. [Writing and running
cases](testing.md) covers the rest of the cases file, including how to
write a request where a property cannot be read and how to write a script
that every language must reject.

## Traps in YAML, and in the values a script reads

**Quote every string.** A quoted string is read as written, and an
unquoted one is at the mercy of the parser. `Eq: "None"` and `Eq: None`
are the same to the tools in this repository, and the two forms are not
the same to every YAML library a 51Degrees customer might use.

**Write booleans only as `true` and `false`.** A YAML 1.1 parser, and
several libraries in wide use are YAML 1.1 parsers, reads `yes`, `no`,
`on` and `off` as booleans as well. A script that says `Eq: no` may mean
false in one language and the text "no" in another. The same trap catches
a value name, so a property whose values are Yes and No needs both names
in quotes everywhere the names appear.

**A whole number written with a decimal point is still a whole number.**
The type a property is compared as comes from the literal beside the
operator, and the reference tools read `8.0` as the whole number 8 and
infer `int`. Write a real fraction, such as `0.5`, when the comparison is
meant to be a decimal one.

**Never expect a text value to fall back to false or zero.** A source
value that does not convert to the inferred type makes the property
absent, and the strings `N/A`, `Unknown` and the empty string never
become false, zero or an empty result. The whole script then has no value
and the message names that property. The same rule covers a property that
is present but carries a no value message from the element that produced
it.

**A default value can hide the absence of evidence.** A property that is
mandatory with a default, such as a probability of -1 meaning unknown,
arrives as that default rather than as an absent property, so a
comparison reads the default as a real value and the check comes out
false. Check the documented default value of every source property before
trusting a comparison, and write a case that proves what the default
does. `scripts/HumanConfidence.yaml` answers exactly that problem for
`ip.HumanProbability`, whose default of -1 means the IP address has not
been rated, by writing the check as an `Any` that lets an unrated address
through rather than counting a failed check against the request.

```yaml
  HumanOrUnrated:
    Any:
      - { Property: ip.HumanProbability, Ge: 8 }
      - { Property: ip.HumanProbability, Lt: 0 }
```

The second member of the `Any` is the guard, and writing the guard as
`Lt: 0` rather than `Eq: -1` catches any negative value the data may use
later for the same meaning. Two cases in
`tests/HumanConfidence.cases.yaml` hold the guard in place, being one
where an unrated address of -1 leaves every check passing and one where
an address rated 2 still fails the check, because a guard written too
widely would let a genuinely low rated address through as well.

## What a language package prints for a script at build

Every 51Degrees language package compiles a script once when the pipeline
is built, and the log carries enough to work out what will be evaluated
without anyone opening the file.

At information level, one line for each script naming the script, its
version, the format number, where the script came from (a built in name,
a file path or code) and the output property, along these lines.

```text
info: Derived script 'BrowserCurrency' version 0.1.0, format 1, from
      scripts/BrowserCurrency.yaml, produces 'derived.BrowserCurrency'.
```

The exact wording belongs to each language package. The five things named
in the line do not.

At debug level, one entry for each script printing the compiled model as
canonical JSON, with PascalCase keys in the order the format defines,
two space indent, literal types kept as they were written, the type
inferred for every source property and the computed `Dependencies` list.
Reading that entry tells you what the package built, which is the quickest
way to settle an argument about whether a property was read as an integer
or as text. The whole of the example script prints as the following, cut
short here at the `Values` list.

```json
{
  "Format": 1,
  "Name": "BrowserCurrency",
  "Version": "0.1.0",
  "Output": {
    "Name": "BrowserCurrency",
    "Description": "Whether the browser making the request is a recent release. ...",
    "ValueType": "string",
    "IsList": false,
    "IsMandatory": true,
    "Category": "General",
    "Dependencies": [
      "device.BrowserReleaseYear",
      "device.BrowserReleaseAge"
    ],
    "Values": [ ... ]
  },
  "Properties": {
    "device.BrowserReleaseYear": {
      "Type": "int"
    },
    "device.BrowserReleaseAge": {
      "Type": "int"
    }
  },
  "Checks": {
    "Known": {
      "Property": "device.BrowserReleaseYear",
      "Gt": 0
    },
    "Recent": {
      "Property": "device.BrowserReleaseAge",
      "Lt": 12
    }
  },
  "Rules": [
    {
      "When": {
        "Failed": "Checks",
        "Eq": 0
      },
      "Then": "Current"
    },
    {
      "Else": "Dated"
    }
  ]
}
```

One more line can appear. Where a script is marked `Deprecated`, the
package logs a warning carrying the `DeprecationNote` of that script.

## What the pipeline checks when the element is added

Compiling a script proves the script itself is sound, and it cannot prove
that the pipeline around the element supplies what the script reads,
because the element cannot see the rest of the pipeline until the
pipeline is assembled. So a second check runs when the pipeline adds the
element, and the check walks the elements in order.

**A source property that no earlier element supplies fails the pipeline
build.** The message names the property, and where an element that would
supply the property sits later in the pipeline the message names that
element too, since the fix is then the order of the elements rather than
a missing engine. The build is failed rather than a line being logged
because every property a script names is needed, so a pipeline that
cannot supply one would produce no value on every single request, and
failing the build says so at the point the mistake was made rather than
on the first request that reaches a customer.

**Two elements in one pipeline producing the same derived property name
fail the pipeline build** in the same check, because the name a customer
reads under `derived` would otherwise depend on which element ran last.

## The pull request checklist

Work through the following before asking for a review, because each point
is either checked automatically on the pull request or is the reason a
reviewer sends a script back.

1. **The schema passes.** `node tools/run-cases.mjs` reports no failures,
   and the pull request check also runs the script through
   `schema/format-1.schema.json`, which an editor can use to offer
   completions while you type.
2. **The cases reach every rule, and every output value a rule can
   return.** The `Rules` column reads as a whole number over itself, for
   example `2/2`, and the run fails until it does. A value under
   `Output.Values` that no case returns raises a notice rather than a
   failure, because the metadata can declare a value no rule produces, so
   read every notice and answer it with a case unless the value really is
   one no rule can return. Cases that only cover the values a reviewer
   expects are not enough, so include the request where a property cannot
   be read and the request where a value arrives in its string form.
3. **Every property the script names is in the data.** A property that no
   pipeline supplies makes the script produce no value on every request,
   so a property that is only proposed stays out of the script until it
   ships.
4. **The version is bumped.** Any change to `Output`, `Checks` or `Rules`
   needs a new `Version`, following
   [semantic versioning](https://semver.org). The pull request check
   compares the script against the base branch and fails when the version
   has not moved. A change to a comment above the `Format` line needs no
   bump, and a change to a description does, because `Description` sits
   inside `Output`.
5. **The description says what the property asserts and where the
   property is weak.** Write what a value means and what the property
   cannot see, such as a check that only works once client side
   JavaScript has run. Do not write how far a reader should trust the
   value, because the honest limits let a reader judge the trust for
   themselves.
6. **Nothing internal or unpublished is in the file.** This repository is
   public. A property that is not yet released, an issue that is not
   public, a customer name, a threshold agreed in a private conversation
   and an internal file share path all stay out. Where a script depends
   on a property that is not in the data yet, say so in the head comment
   and link only to something a reader outside 51Degrees can open.
7. **A script is never deleted or renamed.** A script that should no
   longer be used gains `Deprecated: true` and a `DeprecationNote` saying
   what to use instead, so that a customer configuration naming the
   script keeps working.

## Contributing, and the licence

The general 51Degrees contribution guidance, covering branches, commit
messages and how a pull request is reviewed, is at
[common-ci/CONTRIBUTING.md](https://github.com/51Degrees/common-ci/blob/main/CONTRIBUTING.md).

There is no contributor licence agreement to sign. This repository is
licensed under the
[European Union Public Licence version 1.2](https://opensource.org/licenses/EUPL-1.2),
and a contribution is made under the same licence.

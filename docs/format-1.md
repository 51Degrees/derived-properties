# Derived property scripts, format 1

The reference for the script format that `DerivedPropertyElement` reads.
Every language implementation of the element (.NET, Node, Java, Python and
PHP) is tested against the behaviour described here, so this document is
the contract rather than a summary of one.

The behaviour below is the behaviour of the reference implementation in
[`tools/validate.mjs`](../tools/validate.mjs) and
[`tools/evaluate.mjs`](../tools/evaluate.mjs), which is the JavaScript
code this repository ships and tests. Where the internal design note and
that code disagree, the code is what actually happens, and this document
follows the code.

## What a script is

A **script** is one file, written in [YAML](https://yaml.org) or in
[JSON](https://www.json.org/json-en.html), describing how one output
property is computed from properties that other elements in a 51Degrees
Pipeline have already produced. One file produces exactly one output
property. YAML and JSON are both accepted and produce the same result, so
the choice between the two is only a matter of taste.

A script names the property it produces, names the source properties it
reads inside its conditions, defines any number of named tests, and then
lists rules that are read in order until one of them matches. Nothing
else happens. There is no arithmetic between properties, no loops and no
way to call out to anything.

## The one rule

This is the whole of how a script behaves, and it is worth reading before
anything else on this page.

A script names source properties inside its conditions. **Where every one
of those properties is available, the checks and the rules run and a
value is chosen. Where any one of them is not available, the script
produces no value, and the message names every property that was missing
along with what its source element said about each one.**

There is exactly one way to get no value and exactly one way to get a
value. A property is either there or it is not. There is no third state,
no way to mark a property as one the script can manage without, and no
way for a condition to come out as anything but true or false.

## What the element does, and what it does not do

`DerivedPropertyElement` turns property values that are already in the
flow data into one more property value. That is the whole of its scope.

The element holds no data file, sends no request over the network, keeps
nothing between one request and the next, and reads no evidence from the
request. Anything that needs one of those four is a different element and
not a script. In particular, work that needs a network call, work that
needs state carried between requests, and work that needs the raw
evidence (headers, query string, cookies) parsed are all outside this
format by design.

The format is deliberately kept small. It is for properties that follow
simply from properties already in the flow data, such as banding a number
or combining two flags into one answer. Anything more involved is written
as an ordinary flow element in code, the way such work is done today, and
that route is neither a fallback nor a lesser option. The format is not a
programming language and it is not meant to grow into one, so a script
that is becoming hard to read is a sign that the work belongs in code.

Where the work needed falls outside that boundary, write a flow element
instead. The 51Degrees documentation for
[Custom Flow Elements](https://51degrees.com/documentation/_pipeline_api__features__custom_elements.html)
covers how to build one.

## Terms

These words are used throughout with the meanings given here.

- **Script.** One YAML or JSON file describing one output property, as
  above.
- **Model.** The in-memory form a script becomes after it has been parsed
  and validated. Every language builds the same model from the same
  script, and everything after parsing works on the model rather than on
  the text.
- **Check.** A named true-or-false test defined in a script under
  `Checks`. A check can be reused by name in a rule, and checks can be
  counted.
- **Source property.** A property produced by another element, named in a
  condition as `elementDataKey.PropertyName`, for example
  `device.IsCrawler`.
- **Available.** A source property is available when the element that
  supplies it is in the flow data, the property is present, the property
  has a value, and that value can be read as the type the script compares
  it with. A property that fails any one of those four is not available.
- **Element data key.** The short name a pipeline element publishes its
  results under, for example `device` for device detection and `ip` for
  IP intelligence. The output of `DerivedPropertyElement` itself appears
  under the key `derived`.
- **Aggregate.** A count of checks, being how many passed or how many
  failed.
- **Group.** What an aggregate counts over, being either the word
  `Checks`, meaning every named check in the script, or a list of check
  names.

## An example, in full

`scripts/HumanConfidence.yaml`, without the long comment header the real
file carries.

```yaml
Format: 1
Name: HumanConfidence
Version: 0.2.0
Output:
  Name: HumanConfidence
  Description: The confidence that the request came from a device being used by a human who is viewing the page. Returns one of High, Medium, or Low.
  ValueType: string
  IsList: false
  IsMandatory: false
  IsObsolete: false
  Category: General
  IsPopular: true
  ExportValues: true
  Values:
    - Name: High
      Description: High confidence that the request is from a device being used by a human who is viewing the page.
    - Name: Medium
      Description: The evidence is mixed and the request cannot be placed either way. A human may be viewing the page.
    - Name: Low
      Description: Almost certainly no human is directly involved in viewing the page content.
Checks:
  NotCrawler:  { Property: device.IsCrawler,  Eq: false }
  Current:
    All:
      - { Property: device.BrowserReleaseYear, Gt: 0 }
      - { Property: device.BrowserReleaseAge,  Lt: 2 }
  HumanOrUnrated:
    Any:
      - { Property: ip.HumanProbability, Ge: 8 }
      - { Property: ip.HumanProbability, Lt: 0 }
Rules:
  - When: { Property: device.IsCrawler, Eq: true }
    Then: Low
  - When: { Failed: Checks, Eq: 0 }
    Then: High
  - When: { Failed: Checks, Le: 1 }
    Then: Medium
  - Else: Low
```

Read from the top down, the rules say that a declared crawler is `Low` on
its own, that no failed check is `High`, that one failed check is
`Medium`, and that everything left is `Low`.

Two things in the block above are worth pausing on rather than copying.

The first is the unit of `device.BrowserReleaseAge`, which is a count of
months, so `Lt: 2` means the browser was released less than two months
ago.

The second is why `HumanOrUnrated` is written as an `Any` rather than as
a single comparison, and the reason is what the 51Degrees data supplies.
`ip.HumanProbability` is mandatory in the data with a default of -1,
where -1 means the IP address has not been rated, so an unrated address
arrives as a real value rather than as an absent property. A plain
`{ Property: ip.HumanProbability, Ge: 8 }` reads -1 as false and counts a
failed check against a request that carries no evidence either way, which
on these rules is the difference between `High` and `Medium` for a real
person whose address happens to be unrated. The `Any` makes the check
true where the address says human and also where the address says
nothing, which reads as "the IP address is not evidence against a human".

The consequence is a choice rather than a fact. An unrated IP address
now counts the same as a
high one, so a request with a current browser that is not a crawler can
reach `High` on an unrated address. Format 1 has no third state, so a
check is either true or false, and the alternative was to keep costing
real people a failed check for something they did not do. The guard is
written `Lt: 0` rather than `Eq: -1` so that any negative value the data
may use later for the same meaning is caught by the same rule.

The `Output` block is the definition of the property. There is no second
copy of it anywhere, so nothing has to be kept in step with anything and
a change to `Output` is a change to the property.

The script names four source properties, being `device.IsCrawler`,
`device.BrowserReleaseYear`, `device.BrowserReleaseAge` and
`ip.HumanProbability`, and a request where any one of the four is not
available produces no value with a message naming it.

Those four are the four that are in the 51Degrees data today. Further
properties have been proposed for the same job and none of them is named
by the script yet. Naming a property makes it necessary, so a script
naming a property that is not in the data would produce no value for
every single request. Each one joins the script, with a new `Version`,
once it is in the data.

## The top level keys

Keys are written in PascalCase, matching 51Degrees pipeline
configuration files and 51Degrees property metadata. Parsers match
key names without regard to letter case, so `format` and `FORMAT` are
both read as `Format`, and PascalCase is the form to write.

| Key | Required | Meaning |
| --- | --- | --- |
| `Format` | yes | The version of the script language, as a whole number. `1` is the only value format 1 accepts, and any other value is a fault |
| `Name` | yes | What configuration selects the script by. Matches the pattern `^[A-Za-z][A-Za-z0-9]*$`, and must equal the file name without its extension |
| `Version` | yes | The author's [semantic version](https://semver.org) as a string, for example `1.0.0`, `2.1.0-beta.3` or `1.0.0+build5`. Printed in the build log, and plays no part in selecting a script |
| `Deprecated` | no | Boolean, false where absent. A deprecated script still works and logs a warning at build time naming `DeprecationNote` |
| `DeprecationNote` | only where `Deprecated` is true | A string saying what to use instead. A deprecated script without a note is a fault, and so is a note on a script that is not deprecated |
| `Output` | yes | The property definition, described below |
| `Checks` | no | A mapping of check names to conditions |
| `Rules` | yes | An ordered list of at least one rule, the last of which is an `Else` |

Any other key at the top level is a fault, and the fault message lists
the keys format 1 knows, so a typed key name is caught rather than
quietly ignored.

There is no separate description at the top level because
`Output.Description` already says what the property asserts, and that
same wording is what the log and the published documentation use.

## Output, the property definition

`Output` is a complete property definition and not a cut-down one. Its
field names and their meanings are those 51Degrees uses for the metadata
of every property, so the element exposes full metadata for a derived
property in the same shape as for any other property, and a script
accepted into a 51Degrees product is read as it stands rather than being
copied or translated. **There is one definition of a derived property and
it is the `Output` block of its script.**

| Field | Required | Format 1 constraint |
| --- | --- | --- |
| `Name` | yes | Matches `^[A-Za-z][A-Za-z0-9]*$`. This is the property name published under the `derived` element data key |
| `Description` | yes | A non empty string saying what the property asserts, not how far to trust it. This is the wording a customer reads, so it is worth the same care as any published description |
| `ValueType` | yes | One of `string`, `bool`, `int`, `double`, matched without regard to letter case. Every other 51Degrees value type (the weighted types, `javascript`, `ip`, `wkb` and the rest) is a fault in format 1 |
| `IsList` | yes | Must be `false`. List outputs are deferred to a later format on purpose |
| `DefaultValue` | no | Metadata only, described below. Must convert to `ValueType`, and must be one of `Values` where `Values` is given |
| `Values` | no | A list of `{ Name, Description }` entries. Allowed only where `ValueType` is `string` or `int`. `Name` is a string or a whole number and is required, `Description` is a string and is optional. Two entries with the same name are a fault. Where `Values` is given, every `Then`, every `Else` and `DefaultValue` must name one of the entries |
| `IsMandatory`, `IsObsolete`, `IsPopular`, `ExportValues` | no | Booleans, carried into the metadata unchanged |
| `Category` | no | A string, carried through and exposed as the category in the element's property metadata |
| `Url`, `StoredValueType` | no | Strings, carried through unchanged |
| `DisplayOrder`, `PropertyId` | no | Whole numbers, carried through unchanged |
| `VendorIds` | no | A list, carried through unchanged |
| `Dependencies` | no | A list. Where the script does not give it, the validator computes it as every source property the checks and the rules name, each in `elementKey.PropertyName` form |

**`DefaultValue` is metadata and nothing more.** It is the string form of
the default recorded for the property, it is carried
through to the property definition the element exposes, and it is checked
against `ValueType` and against `Values`. Nothing reads it while a
request is being processed, so it is not a fallback and it is never the
answer a script gives. Every script ends in an `Else`, so a script that
has read its source properties always chooses a value from its own rules,
and a script that could not read one of them has no value at all rather
than the default.

Any other key under `Output` is a fault. A metadata field name that has
been typed wrongly is caught rather than being dropped without a word,
which is the reason the block is closed rather than open.

The canonical order the fields are printed in, which is also the order
worth writing them in, is `Name`, `Description`, `ValueType`,
`StoredValueType`, `DefaultValue`, `IsList`, `IsMandatory`, `IsObsolete`,
`Category`, `IsPopular`, `ExportValues`, `Url`, `DisplayOrder`,
`PropertyId`, `VendorIds`, `Dependencies`, `Values`.

## Source properties and their inferred types

A source property is named directly inside a condition as
`elementDataKey.PropertyName`, for example `device.IsCrawler`. Both halves
match the pattern `^[A-Za-z][A-Za-z0-9]*$`, and a name without the dot,
such as a bare `IsCrawler`, is a fault. Property names are matched without
regard to letter case, as the Pipeline matches property names elsewhere.

A condition may name `derived.SomeProperty` where `SomeProperty` is
produced by another script in the same element or by an earlier element,
so one derived property can be built from another.

There is no block declaring the type of each source property, because the
type is worked out from the literal value the property is compared
against.

| Literal in the script | Inferred type |
| --- | --- |
| `true` or `false` | `bool` |
| A number whose value is whole, so `8`, `8.0` and `8e0` alike | `int` |
| A number whose value has a fractional part, such as `8.5` | `double` |
| Text, quoted or unquoted | `string` |
| A list, for `In` and `NotIn` | The type its members share. Whole numbers and numbers with a fractional part may sit in one list, and such a mixed list reads as `double`. Any other mixture of types is a fault |

The rule for a number is about the value and not about the way the value
was written, so writing `8.0` rather than `8` changes nothing. The rule is
written that way because it is the only rule every language can carry out
in the same way, since JavaScript has a single number type and several
YAML libraries do not hand back the text a value was written as.

There is a trap in the rule. Writing `Lt: 2.0` does
not make a comparison read decimal values, because 2.0 is a whole number
and so infers `int`, and a source value of `1.5` then cannot be read at
all, which makes the property unavailable and leaves the whole script
with no value. Where a property really does carry decimal values, compare
against a value that has a fractional part, such as `Lt: 1.999` or
`Le: 2.5`.

Every use of the same property across one script must infer the same
type. Where two conditions infer different types, the validator reports a
fault naming both places, so `{ Property: device.IsCrawler, Eq: false }`
in one check and `{ Property: device.IsCrawler, Eq: "False" }` in another
is rejected rather than silently taking one of the two.

Because a property has exactly one inferred type across the whole script,
whether the property can be read is a fact about the property rather than
about each place the property is used.

The inferred type is the type the source value is converted to at run
time, which the conversion table further down describes.

## Conditions

A condition is a mapping in exactly one of the following forms.

| Form | Example |
| --- | --- |
| Comparison | `{ Property: ip.HumanProbability, Ge: 8 }` |
| Check reference | `{ Check: NotCrawler }` |
| Aggregate comparison | `{ Failed: Checks, Le: 1 }` |
| All | `{ All: [ { Check: Current }, { Check: HumanOrUnrated } ] }` |
| Any | `{ Any: [ { Check: NotCrawler }, { Check: HumanOrUnrated } ] }` |
| Not | `{ Not: { Property: device.IsCrawler, Eq: true } }` |

A comparison carries one `Property` key and exactly one operator key.
Two operators in one mapping are a fault, as is a mapping with a
`Property` and no operator, and so is an operator name format 1 does not
know. `All` and `Any` each take a list of at least one condition and must
be the only key of their mapping. `Not` takes one condition and must
likewise be the only key of its mapping. A `Check` reference names a
check defined in the same script, and unlike key names, a check name is
matched exactly as written, so `{ Check: notcrawler }` does not find a
check named `NotCrawler`.

### The operators

| Operator | Allowed on | Meaning |
| --- | --- | --- |
| `Eq` | `bool`, `int`, `double`, `string` | Equal. Strings compare ordinally and with regard to letter case |
| `Ne` | `bool`, `int`, `double`, `string` | Not equal, on the same terms as `Eq` |
| `Gt` | `int`, `double` | Greater than |
| `Ge` | `int`, `double` | Greater than or equal to |
| `Lt` | `int`, `double` | Less than |
| `Le` | `int`, `double` | Less than or equal to |
| `In` | `bool`, `int`, `double`, `string` | The value is one of the members of a non empty list of literals |
| `NotIn` | `bool`, `int`, `double`, `string` | The value is none of the members of a non empty list of literals |
| `StartsWith` | `string` | Ordinal, with regard to letter case |
| `EndsWith` | `string` | Ordinal, with regard to letter case |
| `Contains` | `string` | Ordinal, with regard to letter case |

`Gt`, `Ge`, `Lt` and `Le` are deliberately kept off strings, because the
order two strings sort in differs between languages and a script must
give the same answer everywhere.

A null literal is a fault wherever it appears, including inside a list
for `In` and `NotIn`, and an empty list for `In` or `NotIn` is a fault as
well. There is no operator that asks whether a property is present,
because a script only ever runs when every property it names is
available.

### Aggregate comparisons

An aggregate counts checks. `Passed` is the number of checks in the group
that came out true and `Failed` is the number that came out false. Every
check in the group is one or the other, so `Passed` and `Failed` always
add up to the number of checks in the group.

The group is either the word `Checks`, meaning every check the script
defines, or a list of check names such as `[ NotCrawler, Current ]`. A
name in that list that is not a defined check is a fault.

An aggregate is compared with a whole number and with nothing else, as in
`{ Failed: Checks, Le: 1 }`. The operators that work here are `Eq`, `Ne`,
`Gt`, `Ge`, `Lt` and `Le`, because a count is a whole number, and any
other operator is a fault. An operand that is not a whole number, an
aggregate among them, is a fault as well.

Because `Passed` and `Failed` add up to the size of the group, either one
can say what the other says, so `{ Failed: Checks, Eq: 0 }` and
`{ Passed: Checks, Eq: 3 }` mean the same thing in a script with three
checks. Writing the count of failures is usually the clearer of the two,
since a rule then survives a check being added.

An aggregate is a condition and never a value. `Then` and `Else` hold a
literal, so a script cannot publish a count of its own checks as its
output.

Aggregates count checks only. Rules are never counted.

## Evaluation is two-valued

Every check and every `When` comes out true or false, and never anything
else. There is no third state, because the checks and the rules are only
ever run on a request where every source property the script names has
already been read, which the next section covers.

| Condition | Result |
| --- | --- |
| A comparison | true or false |
| `All` | true where every member is true, false otherwise |
| `Any` | true where at least one member is true, false otherwise |
| `Not` | true becomes false and false becomes true |
| An aggregate comparison | true or false |
| A check reference | the result the named check already produced |

Every check is evaluated once, before any rule is read, and a check
reference then reads the result already worked out rather than
evaluating the check again.

## Rules

`Rules` is an ordered list of at least one rule. Every rule except the
last is `{ When: <condition>, Then: <value> }`, and **the last rule must
be `{ Else: <value> }`**. A `Rules` list whose last entry is not an
`Else` is a fault, an `Else` anywhere but last is a fault, a rule
carrying both `When` and `Else` is a fault, a `When` with no `Then` is a
fault, and any key in a rule other than `When`, `Then` and `Else` is a
fault.

Rules are read in order and the first rule whose `When` is true supplies
the output value. First match wins, and no later rule is read. An `Else`
has no condition and always matches, so a script always produces a value
once its source properties have been read, and there is no path on which
no rule matches.

`Then` and `Else` hold a literal of the type named by `Output.ValueType`,
and nothing else. A whole number written without a decimal point is
accepted where the value type is `double`. Where `Output.Values` is
given, the literal must name one of the entries in that list, compared by
the string form of the name. A null value is a fault.

## Absent and invalid source properties

At the start of each request the element reads every source property of
every script once. A property is **available** where the source element
data is present, the property is present on it, the value is not in a no
value state, and the value converts to the type the script inferred. A
property is **absent** in every other case.

Where every property a script names is available, the checks and the
rules run and a value is chosen. Where any one of them is absent, nothing
is evaluated and the script produces no value.

### When a property is absent

Nothing is evaluated. The output property is present in the element data
with no value, and reading it raises the language's existing no value
error, which is `AspectPropertyValue` with a `NoValueMessage` in .NET and
the matching mechanism in each other language. The message names every
absent property rather than only the first one found.

The message is built in this shape, with the wording taken from
`missingMessage` in `tools/evaluate.mjs`. The real message is one line,
and the example below is wrapped only to fit the page.

```text
Derived property 'HumanConfidence' has no value because 2 source
properties were not available. 'device.BrowserReleaseYear' (element
'device' has no value for 'BrowserReleaseYear': property not present on
this request). 'ip.HumanProbability' (element 'ip' has no value for
'HumanProbability': property not present on this request). Usual causes
are the element that supplies the property not being in the pipeline, or
being added after this element rather than before it, the property being
excluded in the engine configuration, the property not being included in
the resource key, or JavaScript that populates the property not having
run yet.
```

The pieces are fixed. The message opens with the words
`Derived property '<Output.Name>' has no value because`, followed by a
space and then `1 source property was not available.` where exactly one
property is absent, or `<count> source properties were not available.`
where more than one is. Each absent property then contributes
`'<name>' (<reason>).`, and the properties appear in the order the script
first named them, with the checks read before the rules, separated by
single spaces. The closing sentence is the constant `USUAL_CAUSES`
exported from `tools/evaluate.mjs`, quoted here in full.

> Usual causes are the element that supplies the property not being in
> the pipeline, or being added after this element rather than before it,
> the property being excluded in the engine configuration, the property
> not being included in the resource key, or JavaScript that populates
> the property not having run yet.

The second of those causes is worth reading twice, because it is the one
an implementation cannot catch when the pipeline is built. Where an
element runs is not judged at build, since a pipeline holding elements
that run in parallel reports them in an order that does not say what ran
before what. An element added after a source it reads therefore builds,
and produces no value on every request, with this message naming the
property. An implementation should log that once rather than on every
request, because it will otherwise repeat for the life of the process.

The reason inside the brackets takes one of four shapes, from `readSlot`
in `tools/evaluate.mjs`, where `<key>` is the element data key and
`<Property>` is the property name.

| Why the property is absent | Reason text |
| --- | --- |
| The property is not in the flow data at all, or its value is null | `element '<key>' has no value for '<Property>': property not present on this request` |
| The source value exists but carries a no value state of its own | `element '<key>' has no value for '<Property>': <the source's own no value message>` |
| The value is there but does not convert to the inferred type | `held '<the value>' which cannot be read as <type>` |
| The value is a list where a single value is needed | `held a list where a single value is needed` |

The first two shapes name the element and the property, because the
message is being carried up from the source element. The last two do not
repeat the name, because the failure happened while converting a value
that was found.

No new missing property reason and no change to the existing reason
enumeration is needed for any of the above, since the wording travels in
the no value message.

### Conversion

A source value arrives either as its native type or as a string, and both
are accepted for every inferred type. Values are never coerced loosely,
so the strings `N/A`, `Unknown` and the empty string never become `false`
or `0`, they make the property absent.

| Inferred type | Accepted native | Accepted string | Rejected, as examples |
| --- | --- | --- | --- |
| `bool` | a boolean | `true` or `false` in any letter case, with surrounding whitespace ignored | `N/A`, `Unknown`, `1`, `yes`, the empty string |
| `int` | a whole number in the range below | an optional sign then digits, with surrounding whitespace ignored, and the result must be in the range below | `1.0`, `Unknown`, the empty string, `3000000000` |
| `double` | any finite number, whole or not | an optional sign, digits with a full stop as the decimal separator, and an optional exponent | `Unknown`, the empty string, a value that is not finite |
| `string` | a string, a boolean, or a number | taken as written | a mapping, and a list that is not a list of weighted values |

**`int` is a signed 32 bit whole number**, so the range is -2147483648 to
2147483647, which is what the type is called in .NET and in Java. A
source value outside the range cannot be read, so the property is absent
and the script produces no value naming that property. A whole number
written in a script outside the range infers `double` rather than `int`.
The width is fixed rather than left to each language because otherwise a
value such as 3000000000 would be readable in one language and absent in
another, which would change the answer a script gives. Where a property
really does carry values wider than that, compare against a number with a
fractional part so the property is read as a `double`.

A native boolean read as a string becomes `True` or `False` with a
capital first letter, and a native number read as a string becomes its
plain printed form, so `8` becomes `"8"`.

A list of weighted values, meaning a list whose members each carry a
`Value` and a `Weight`, takes the value with the highest weight, and the
first member wins where two weights are equal. A list of anything else,
where a single value is needed, makes the property absent.

## Writing YAML that reads the way you meant

Two habits avoid almost every surprise.

**Quote strings.** Write `Eq: "None"` rather than `Eq: None`. An unquoted
word can be read as something other than text depending on which YAML
parser is doing the reading, and the five language implementations do not
all use the same parser. Quoting removes the question.

**Write booleans as `true` and `false` and nothing else.** YAML 1.1
parsers, which several languages still ship, read `yes`, `no`, `on` and
`off` as booleans, so `Eq: no` can arrive as the boolean false in one
language and as the string `"no"` in another. The two readings infer
different types and give different answers. The reference tools in this
repository use the YAML core schema, where `yes` stays the string
`"yes"`, so a script that relies on `yes` meaning true will pass the
checks here and then behave differently in a language whose parser
follows YAML 1.1.

Two smaller points follow from the same care. Write `Version: "1.0.0"` in
quotes, since an unquoted `1.0` would be read as a number rather than as
a version string. Keep numbers unquoted where a number is what is meant,
because `Ge: "8"` infers `string` and then fails validation, as `Ge` is
not allowed on strings.

**Write each key once, and mind the letter case.** Keys are matched
without regard to case, so `Name` and `name` in one mapping are one key
written twice and a reader would have to drop one of the two. Both are
refused, in the same way an exact duplicate is refused.

## Two places where the languages are allowed to differ

Everything that decides an answer is the same in every language, and the
conformance cases in [`tests/`](../tests) prove so. Two smaller things
are deliberately not promised to match, and neither can change what a
script returns.

**The line a fault names.** A fault carries a line where the parser
supplies one, and the parsers do not all pick the same line for a mapping
written under its key. One names the line of the key that introduced the
mapping and another names the line of the first key inside it, so the
same mistake can be reported one line apart in two languages. Both point
at the same rule and the path, such as `Rules[3].When.All[1]`, is the
same either way.

**How strictly a JSON script is read.** A script written as JSON is read
as the JSON subset of YAML 1.2, because most languages have one YAML
library rather than a YAML library and a JSON library. So text that a
strict JSON reader would refuse, such as a trailing comma, is read in
some languages and refused in others. Text that is broken is reported as
broken either way and only the wording of the fault differs, so no script
is valid in one language and invalid in another. Write plain JSON and the
question does not arise.

## The schema, and what the schema cannot check

[`schema/format-1.schema.json`](../schema/format-1.schema.json) is a
[JSON Schema 2020-12](https://json-schema.org/draft/2020-12/schema)
description of format 1, published so that an editor can offer completion
and show mistakes as a script is typed. Point an editor at the file, or
at its published address
`https://51degrees.github.io/derived-properties/schema/format-1.schema.json`.

Passing the schema does not mean a script is valid. The schema catches
what a schema can catch, being the shape of the document, the required
keys, unknown keys, and the type of each value.
[`tools/validate.mjs`](../tools/validate.mjs) catches everything else,
including that the last rule is an `Else` and that no earlier rule is
one, that the same property infers one type throughout, that each
operator suits the type inferred for the property beside it, that every
`Check` reference and every check name in a group is defined, that every
`Then`, `Else` and `DefaultValue` names an entry in `Output.Values`, and
that the script name equals its file name.

Every fault carries the script name, where the script came from, a path
in the document such as `Rules[3].When.All[1]`, the line number where the
parser can supply one, and a plain message. All faults in a script are
collected and reported together, so one run shows everything that is
wrong with a file rather than stopping at the first problem.

# 51Degrees Derived Properties

![51Degrees](https://raw.githubusercontent.com/51Degrees/common-ci/main/images/logo/360x67.png "Data rewards the curious") **Derived Properties**

[Developer Documentation](https://51degrees.com/documentation?utm_source=github&utm_medium=readme&utm_campaign=derived-properties&utm_content=readme.md&utm_term=top "developer documentation")

## Introduction

This repository holds the shared script format for the 51Degrees
`DerivedPropertyElement`, together with the scripts 51Degrees ships. A
script is one YAML or JSON file describing how one output property is
computed from properties that other elements in a
[51Degrees Pipeline](https://51degrees.com/documentation?utm_source=github&utm_medium=readme&utm_campaign=derived-properties&utm_content=readme.md&utm_term=pipeline)
have already produced.

Every language implementation of the element reads the same files from
here, so one script gives the same answer in .NET, Node, Java, Python and
PHP.

The
[specification](https://github.com/51Degrees/specifications/blob/main/pipeline-specification/pipeline-elements/derived-property-element.md)
for the element is also on GitHub and is recommended reading if you want
to understand the design rather than only use it.

## The one rule

A script names source properties inside its conditions. Where every one
of those properties is available on a request, the checks and the rules
run and a value is chosen. Where any one of them is not available, the
script produces no value, and the message names every property that was
missing along with what its source element said about each one.

There is exactly one way to get no value and exactly one way to get a
value. A property is either there or it is not, and there is no third
state anywhere in the format.

## What a script may do, and what belongs elsewhere

A script turns property values into another property value by rules, and
does nothing else. Work that needs a network call, work that has to keep
state between requests, and work that reads evidence out of the request
all belong in a pipeline element of your own rather than in a script. The
51Degrees documentation on
[building a custom element](https://51degrees.com/documentation/_pipeline_api__features__custom_elements.html?utm_source=github&utm_medium=readme&utm_campaign=derived-properties&utm_content=readme.md&utm_term=custom-elements)
covers how to write one.

The format is deliberately kept small. It is for properties that follow
simply from properties already in the flow data, such as banding a number
or combining two flags into one answer. Anything more involved is written
as an ordinary flow element in code, the way such work is done today, and
that route is neither a fallback nor a lesser option. The format is not a
programming language and it is not meant to become one.

## What is in the repository

| Folder | What is in the folder |
| --- | --- |
| [`scripts/`](scripts) | The scripts 51Degrees ships, one file per output property. Each script carries a comment block at the top saying where every threshold came from and whether it has been reviewed |
| [`docs/`](docs) | The format reference, the authoring guide and the testing guide |
| [`schema/`](schema) | A JSON Schema (2020-12) that editors and the checks use to validate a script |
| [`tests/`](tests) | A case file for each script, plus `tests/invalid/` holding scripts that every implementation has to reject |
| [`tools/`](tools) | The reference parser, validator and evaluator, written in JavaScript, plus the programs the checks run |
| [`site/`](site) | The tester page, which runs a script in a browser against inputs you type |
| [`.github/workflows/`](.github/workflows) | The checks that run on every pull request and on every push to `main` |

A script below version 1.0.0 is a draft, may be rewritten freely, and has
not been reviewed by the 51Degrees Senior Data Operators. Read its rules
as a starting point rather than as settled values.

## The property definition lives in the script

The `Output` block of a script **is** the definition of its property,
carrying the description, the value type and the value list a customer
reads. There is no second copy of it anywhere, so a script and its
metadata cannot drift apart and there is nothing to reconcile. A change
to `Output` is a change to the property itself.

## Selecting a script

Scripts are selected the same way in every language, through the two
build parameters below, because the 51Degrees Pipeline reads element
configuration from the same file format in all of them. `Scripts` names
scripts built into the language package, and `ScriptFiles` gives paths to
files in your own environment, where a path may hold a wildcard.

```json
{
  "PipelineOptions": {
    "Elements": [
      {
        "BuilderName": "DerivedPropertyElement",
        "BuildParameters": {
          "Scripts": "HumanConfidence",
          "ScriptFiles": "derived/*.yaml"
        }
      }
    ]
  }
}
```

**Write a list of scripts as one string with commas between the names,
rather than as a JSON array.** The Pipeline reads build parameters into a
dictionary of strings to objects, and a JSON array arrives there as a
plain object rather than as a list, so the element would go looking for a
single script of that name and fail with a message saying the file does
not exist. A string is split on the commas, and a name that holds a comma
is wrapped in double quotes. The same holds for every list valued build
parameter in the Pipeline rather than only for these two.

Every script writes into the element data key `derived`, one property per
script, named by the `Output.Name` field of that script.

### In code

Each language also offers the same three sources in code. The .NET form
is below and the other languages follow their own conventions.

```csharp
var derived = new DerivedPropertyElementBuilder(loggerFactory)
    // A script shipped inside the package.
    .AddScript(BuiltInScript.HumanConfidence)
    // A file, or several files, from your own environment.
    .AddScriptFile("derived/*.yaml")
    // The text of a script held by your own code, YAML or JSON.
    .AddScript("MyProperty", scriptText)
    .Build();
```

### Which repositories use these scripts

Each language implementation embeds this repository as a git submodule,
so the list of them is whatever currently references it. This command
answers the question rather than a list here going stale.

```text
gh search code "derived-properties" --filename=".gitmodules" --owner=51Degrees
```

## Trying a script without writing any code

**[Open the script tester](https://51degrees.github.io/derived-properties/)**

[`site/index.html`](site/index.html) runs a script against inputs you
type and shows which properties were read, what each check decided and
which rule matched. It is published through GitHub Pages from `main`.

To run it from a clone instead, serve the folder through any local web
server, because the page loads the tools as ES modules and a browser will
not load a module from a `file://` address.

## Documentation

- [`docs/format-1.md`](docs/format-1.md), the format reference, which is
  the contract every language implementation is tested against.
- [`docs/authoring.md`](docs/authoring.md), how to write a script, worked
  from a blank file to a passing case.
- [`docs/testing.md`](docs/testing.md), how to write cases and how to run
  the checks on your own machine.

## Contributing

How 51Degrees handles branches, commits, reviews and releases is written
up once for every 51Degrees repository at
[51Degrees/common-ci](https://github.com/51Degrees/common-ci/blob/main/CONTRIBUTING.md),
and applies here. The checklist for a pull request that adds or changes a
script is at the end of
[`docs/authoring.md`](docs/authoring.md).

There is no contributor licence agreement to sign. Work contributed here
is licensed under the same licence as the rest of the repository.

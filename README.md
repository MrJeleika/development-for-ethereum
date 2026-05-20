# Blockchain Academy — Solidity Template

Template repo for the Solidity track of the Blockchain Academy course, run by
[Redduck](https://redduck.io). Course materials, task briefs, and submission
live on [academy.redduck.io](https://academy.redduck.io). Clone this repo,
work through the tasks, push to your fork, and submit the URL on the academy
website.

## Requirements

- Node.js **22+** (see `.nvmrc`).
- npm (ships with Node).

## Layout

```
.
├── hardhat.config.ts        # one config for the whole repo
├── package.json
├── tsconfig.json
└── 01-token/                # current task
    ├── TASK.md              # brief — read this first
    ├── contracts/           # Solidity sources (edit these)
    └── tests/               # test suite
```

Each task is a self-contained folder with its own `TASK.md`, `contracts/`, and
`tests/`. **Only one task is compiled and tested at a time** — selected by the
`TASK` environment variable.

## Getting started

```bash
npm install
npm run compile:01-token
npm run test:01-token
```

You can also pick a task with the `TASK` env var:

```bash
TASK=01-token npm test
TASK=01-token npm run coverage
```

Repo-wide helpers:

```bash
npm run lint:sol      # solhint over all tasks
npm run format:fix    # prettier over the repo
```

## Workflow per task

1. Open the task folder and read `TASK.md` — it explains what to build and
   links to anything else you need.
2. Implement the contract in `contracts/`.
3. Write tests in `tests/` if the task asks you to. Early tasks ship with the
   test suite pre-defined; later capstones require you to write your own.
4. Run `npm run test:<task>` until everything passes.
5. Commit, push to your fork, and submit the repo URL on
   [academy.redduck.io](https://academy.redduck.io).

## Rules

- Don't change function signatures, event signatures, or custom error names in
  task contracts — the tests and the reviewer match on them.
- Don't modify pre-defined test files. If a task asks you to write tests, add
  new ones; don't edit the existing spec.
- Don't copy implementations from OpenZeppelin, Solmate, Solady, or tutorials.
  See the per-task `TASK.md` for the full reasoning.

# Blockchain Academy — Solidity Template

Template repo for Solidity tasks in the Blockchain Academy course. Clone this
repo, complete the tasks, push to your fork, and submit the URL on the academy
website.

## Stack

- [Hardhat 3](https://hardhat.org) — Solidity dev environment.
- [viem](https://viem.sh) — Ethereum client for tests and scripts.
- [Node.js test runner](https://nodejs.org/api/test.html) — `describe` / `it`.
- TypeScript, prettier, solhint.

## Requirements

- Node.js **22+** (`.nvmrc` is set to 22).
- npm (comes with Node).

## Layout

```
.
├── hardhat.config.ts        # one config for the whole repo
├── package.json
├── 01-counter/              # worked example — read it, don't modify
│   ├── contracts/Counter.sol
│   └── tests/Counter.test.ts
└── 02-simple-token/         # your turn — implement the contract
    ├── contracts/SimpleToken.sol
    └── tests/SimpleToken.test.ts
```

Each task is a self-contained folder with its own `contracts/` and `tests/`.
**Only one task at a time is compiled and tested** — selected by the `TASK`
environment variable (defaults to `01-counter`).

## Getting started

```bash
npm install

# work on the worked example
npm run test:01-counter

# work on your task
npm run test:02-simple-token
```

Fresh clone: the **Counter** task passes, the **SimpleToken** task has failing
tests waiting for your implementation.

## Commands

Per-task scripts (recommended for students):

```bash
npm run compile:01-counter
npm run test:01-counter
npm run coverage:01-counter

npm run compile:02-simple-token
npm run test:02-simple-token
npm run coverage:02-simple-token
```

Or pick a task with the `TASK` env var:

```bash
TASK=02-simple-token npm run compile
TASK=02-simple-token npm test
TASK=02-simple-token npm run coverage
```

On Windows PowerShell:

```powershell
$env:TASK="02-simple-token"; npm test
```

Repo-wide:

```bash
npm run lint:sol             # solhint across all tasks
npm run format:fix           # prettier across the repo
```

## Workflow per task

1. Read the task description on the academy website.
2. Open the task folder (e.g. `02-simple-token/`).
3. Read the test file in `tests/` — it is the **specification**.
4. Edit the `.sol` file in `contracts/` until every test passes.
5. Commit and push. Submit the repo URL on the website.

## Rules

- Do **not** change function signatures, event signatures, or custom error
  names in the task contracts — the tests and the AI reviewer match on them.
- Do **not** modify the test files.
- Stick to Solidity `0.8.28` (the version set in `hardhat.config.ts`).

# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project

eBay-Lister — a tool for creating and managing eBay listings. The codebase is
just getting started; update this file as the stack, structure and commands
are decided.

## Commands

<!-- Fill in once the project has them, e.g.:
- Install: `npm install`
- Dev:     `npm run dev`
- Test:    `npm test`
- Lint:    `npm run lint`
-->

## Conventions

- Never commit secrets: eBay API keys, OAuth tokens, `.env` files. Load
  credentials from environment variables.
- Keep eBay API calls behind a small client module so they can be mocked in
  tests.
- Prefer small, focused commits with descriptive messages.

#!/usr/bin/env node

// Development entrypoint: runs the CLI directly from the TypeScript sources
// in src/ via ts-node — no build step required.
//
//   ./bin/dev.js whoami
//   npm run dev -- emails send --help
//
// oclif's `development: true` remaps dist/ command paths back to src/*.ts and
// loads them through the ts-node hook registered below.
const path = require('node:path')

process.env.NODE_ENV = 'development'
process.env.TS_NODE_PROJECT = path.resolve(__dirname, '..', 'tsconfig.json')

// transpile-only keeps startup fast; run `npm run typecheck` for full checking.
require('ts-node').register({transpileOnly: true})

void (async () => {
  const oclif = await import('@oclif/core')
  await oclif.execute({development: true, dir: __dirname})
})()

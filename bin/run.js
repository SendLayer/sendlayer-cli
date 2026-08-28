#!/usr/bin/env node

// Production entrypoint: runs the compiled CLI from dist/.
// The TypeScript sources in src/ are built to dist/ by `npm run build`.
void (async () => {
  const oclif = await import('@oclif/core')
  await oclif.execute({dir: __dirname})
})()

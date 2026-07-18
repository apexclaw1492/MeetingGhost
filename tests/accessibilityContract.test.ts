import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const appCss = readFileSync(new URL('../src/App.css', import.meta.url), 'utf8');
const indexCss = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');

test('launch stays private and the starter theme cannot override the app shell', () => {
  assert.doesNotMatch(appCss, /fonts\.googleapis\.com|fonts\.gstatic\.com/);
  assert.match(indexCss, /color-scheme:\s*dark/);
  assert.doesNotMatch(indexCss, /width:\s*1126px|prefers-color-scheme/);
  assert.match(indexCss, /text-size-adjust:\s*100%/);
});

test('keyboard, reduced-motion, and coarse-pointer contracts are explicit', () => {
  assert.match(appCss, /:focus-visible/);
  assert.match(appCss, /prefers-reduced-motion:\s*reduce/);
  assert.match(appCss, /pointer:\s*coarse/);
  assert.match(appCss, /min-height:\s*48px/);
});

test('critical navigation, modal, forms, progress, and live messages expose semantics', () => {
  assert.match(app, /role="dialog"/);
  assert.match(app, /aria-modal="true"/);
  assert.match(app, /aria-labelledby="onboarding-title"/);
  assert.match(app, /aria-label="Primary navigation"/);
  assert.match(app, /aria-current=\{tab === 'studio'/);
  assert.match(app, /aria-label="Search saved meetings by title or transcript"/);
  assert.match(app, /aria-label="Ask a question across saved meetings"/);
  assert.match(app, /role="progressbar"/);
  assert.match(app, /aria-valuenow=/);
  assert.match(app, /role="alert"/);
  assert.match(app, /aria-live="polite"/);
});

test('first launch does not silently start optional model downloads', () => {
  const handler = app.match(/const handleOnboarding = \(\) => \{([\s\S]*?)\n  \};/);
  assert.ok(handler, 'onboarding handler should exist');
  assert.doesNotMatch(handler[1], /\bdl\(/);
  assert.match(app, /Optional model downloads stay off until you choose them/);
});

test('diagnostics and integrity checks have visible whole-job deadlines', () => {
  assert.match(app, /exportDiagnostics\(APP_VERSION\)[\s\S]*60_000/);
  assert.match(app, /runIntelligenceIntegrityCheck\(\)[\s\S]*15 \* 60_000/);
  assert.match(app, /Deletion did not finish:[\s\S]*meeting remains visible/);
});

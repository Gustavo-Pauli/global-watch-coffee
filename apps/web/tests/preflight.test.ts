import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { checkEnvironment, isLocalHost, migrationChecksumMatches, validServiceURL } from '../scripts/release-preflight';

test('preflight rejects dangerous service origins and local endpoints in production', () => {
  for (const value of ['http://localhost:3000', 'http://127.0.0.1', 'https://192.168.1.3', 'https://[::1]', 'https://dev.local', 'https://localhost.', 'https://[::ffff:127.0.0.1]', 'https://[fd00::1]']) assert.equal(validServiceURL(value, 'production'), null);
  for (const value of ['https://secret@example.com', 'https://example.com/path', 'https://example.com?key=secret', 'file:///tmp/app', 'http://example.com']) assert.equal(validServiceURL(value, 'local'), null);
  assert.ok(validServiceURL('http://localhost:3000', 'local'));
  assert.ok(validServiceURL('https://example.com/', 'production'));
  assert.equal(isLocalHost('172.31.0.1'), true);
  assert.equal(isLocalHost('172.32.0.1'), false);
});

test('preflight reports missing Gemini and safe facts without echoing credentials', () => {
  const secret = 'private-value-do-not-output-0123456789';
  const result = checkEnvironment({ BETTER_AUTH_SECRET: secret, GOOGLE_CLIENT_SECRET: secret, DATABASE_URL: `postgresql://user:${secret}@localhost:5435/db` }, 'local');
  assert.ok(result.some(check => check.name === 'GEMINI_API_KEY' && check.status === 'fail'));
  assert.ok(result.some(check => check.name === 'GOOGLE_REDIRECT_URI' && check.code === 'console_registration_requires_manual_verification'));
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.equal(JSON.stringify(result).includes('postgresql://'), false);
});

test('migration checksums tolerate checkout line endings but reject modified SQL', () => {
  const sql = 'CREATE TABLE example (id TEXT);\n';
  const checksum = createHash('sha256').update(sql).digest('hex');
  assert.equal(migrationChecksumMatches(sql.replace(/\n/g, '\r\n'), checksum), true);
  assert.equal(migrationChecksumMatches(sql.replace('TEXT', 'INTEGER'), checksum), false);
});

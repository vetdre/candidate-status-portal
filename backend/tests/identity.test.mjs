import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  normalizeEmail,
  normalizePhone10,
  buildIdentityFields,
  resolveMagicToken,
} = require('../../api/webhooks/lever/_lib/identity.js');

test('normalizeEmail trims, lowercases, and rejects invalid values', () => {
  assert.equal(normalizeEmail('  SOMEONE@Example.COM  '), 'someone@example.com');
  assert.equal(normalizeEmail('missing-at-sign'), null);
  assert.equal(normalizeEmail(''), null);
});

test('normalizePhone10 strips punctuation and leading country code', () => {
  assert.equal(normalizePhone10('(555) 123-4567'), '5551234567');
  assert.equal(normalizePhone10('1-555-123-4567'), '5551234567');
  assert.equal(normalizePhone10('12345'), null);
});

test('buildIdentityFields prefers email identity over phone', () => {
  const identity = buildIdentityFields({
    email: ' Test@Example.com ',
    phone: '(555) 123-4567',
    fullName: 'Jane Doe',
  });

  assert.equal(identity.person_key, 'email:test@example.com');
  assert.equal(identity.identity_confidence, 3);
  assert.equal(identity.application_phone, '5551234567');
  assert.equal(identity.application_last_name, 'Doe');
  assert.equal(identity.application_last_name_norm, 'doe');
});

test('buildIdentityFields falls back to phone and leaves person_key null without usable identity', () => {
  const phoneIdentity = buildIdentityFields({ email: '', phone: '5551234567', fullName: 'John Smith' });
  assert.equal(phoneIdentity.person_key, 'phone:5551234567');
  assert.equal(phoneIdentity.identity_confidence, 2);

  const provisionalIdentity = buildIdentityFields({
    email: '',
    phone: '',
    fullName: 'John Smith',
    leverCandidateId: 'ABCD-1234',
  });
  assert.equal(provisionalIdentity.person_key, 'lever_candidate:abcd-1234');
  assert.equal(provisionalIdentity.identity_confidence, 1);
  assert.equal(provisionalIdentity.application_phone, null);

  const emptyIdentity = buildIdentityFields({ email: '', phone: '', fullName: 'John Smith', leverCandidateId: '' });
  assert.equal(emptyIdentity.person_key, null);
  assert.equal(emptyIdentity.identity_confidence, 1);
  assert.equal(emptyIdentity.application_phone, null);
});

test('resolveMagicToken reuses person token when available and otherwise generates as required', async () => {
  const reused = await resolveMagicToken(
    { personKey: 'email:test@example.com', existingApplicationToken: 'app-token' },
    {
      findMagicTokenByPersonKey: async () => 'person-token',
      generateToken: () => 'generated-token',
    }
  );
  assert.equal(reused, 'person-token');

  const generatedForPerson = await resolveMagicToken(
    { personKey: 'email:test@example.com', existingApplicationToken: 'app-token' },
    {
      findMagicTokenByPersonKey: async () => null,
      generateToken: () => 'generated-token',
    }
  );
  assert.equal(generatedForPerson, 'generated-token');

  const preservedApplicationToken = await resolveMagicToken(
    { personKey: null, existingApplicationToken: 'app-token' },
    {
      findMagicTokenByPersonKey: async () => null,
      generateToken: () => 'generated-token',
    }
  );
  assert.equal(preservedApplicationToken, 'app-token');
});
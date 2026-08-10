import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  evaluateMagicInviteEligibility,
  isLeadStage,
  isDeclineStage,
  isInviteEligibleStage,
} = require('../../api/webhooks/lever/_lib/invite.js');
const {
  resolveCurrentStageLabel,
  resolvePortalStageFields,
  normalizeArchiveReason,
} = require('../../api/webhooks/lever/_lib/rules.js');

// Eligibility is evaluated against normalized labels, so tests drive raw Lever values
// through resolveCurrentStageLabel to cover the seam where lead suppression previously failed.
const CONTACTABLE_CANDIDATE = {
  inviteAlreadySent: false,
  archived: false,
  applicationPhone: '5551234567',
  recipientEmail: 'candidate@example.com',
};

function evaluateForStage(rawStage, overrides = {}) {
  return evaluateMagicInviteEligibility({
    ...CONTACTABLE_CANDIDATE,
    ...overrides,
    currentStage: resolveCurrentStageLabel(rawStage),
  });
}

// Authoritative Lever stage export (2026-08-10). Each stage is exercised by id, by display name,
// and as an expanded object, because resolveCurrentStageLabel prefers stage.text over stage.id.
const LEVER_STAGES = [
  { category: 'Lead', name: 'New lead', id: 'lead-new', invite: false },
  { category: 'Lead', name: 'Reached out', id: 'lead-reached-out', invite: false },
  { category: 'Lead', name: 'Responded', id: 'lead-responded', invite: false },
  { category: 'Applicant', name: 'New applicant', id: 'applicant-new', invite: true },
  { category: 'Applicant', name: 'Review', id: '7b042735-93c4-4f99-a12d-5c63060f0cb5', invite: true },
  { category: 'Applicant', name: 'Request Phone Screen', id: '4bde84f8-de25-4dd5-83e0-883f0fe483e0', invite: true },
  { category: 'Applicant', name: 'Decline Candidate', id: 'f3a6f8ba-4ad7-4fe0-ba59-3775ea5ea8af', invite: false },
  { category: 'Interview', name: 'Phone screen', id: 'eb4bc7f9-c6d7-4b82-8eb5-ae53ef2940e6', invite: true },
  { category: 'Interview', name: 'Virtual Interview', id: '4d64f338-9d80-41b8-91a1-867835252a3d', invite: true },
  { category: 'Interview', name: 'Interview', id: 'ec8e09e6-25ee-47e1-a24b-fd43bc1aafa9', invite: true },
  { category: 'Interview', name: 'Second Interview', id: '514e64a3-7600-4e08-a16f-d56fc6d57883', invite: true },
  { category: 'Interview', name: 'Third Interview', id: 'c8bdc4ee-d87a-4102-9ade-a2a199c7b0a8', invite: true },
  { category: 'Interview', name: 'Reference check', id: 'a1339f72-2853-4465-bedc-4d1fd6dc8efc', invite: true },
  { category: 'Interview', name: 'Requisition', id: 'c320de36-762d-4f67-9fdd-d875561e2adb', invite: true },
  { category: 'Interview', name: 'Offer', id: 'offer', invite: true },
  { category: 'Interview', name: 'Asurint Background Screening', id: '7bac956b-7e4f-4d04-8ed5-d0187274a267', invite: true },
];

function describeResult(result) {
  return result.reasons.length ? result.reasons.join(',') : 'sent';
}

test('every Lever stage id produces the correct invite decision', () => {
  for (const stage of LEVER_STAGES) {
    const result = evaluateForStage(stage.id);
    assert.equal(result.shouldSend, stage.invite, `${stage.name} (${stage.id}) -> ${describeResult(result)}`);
  }
});

test('every Lever display name produces the correct invite decision', () => {
  for (const stage of LEVER_STAGES) {
    const result = evaluateForStage(stage.name);
    assert.equal(result.shouldSend, stage.invite, `"${stage.name}" -> ${describeResult(result)}`);
  }
});

test('expanded stage objects produce the correct invite decision', () => {
  for (const stage of LEVER_STAGES) {
    const result = evaluateForStage({ id: stage.id, text: stage.name });
    assert.equal(result.shouldSend, stage.invite, `${stage.name} expanded -> ${describeResult(result)}`);
  }
});

test('no lead stage may trigger a portal invite', () => {
  const leadStages = LEVER_STAGES.filter((stage) => stage.category === 'Lead');
  const leadInputs = [
    ...leadStages.flatMap((stage) => [stage.id, stage.name, { id: stage.id, text: stage.name }]),
    'New Lead',
    'Reached Out',
    { id: 'lead-custom-sourcing-stage' },
  ];

  for (const input of leadInputs) {
    const result = evaluateForStage(input);
    assert.equal(result.shouldSend, false, `expected suppression for ${JSON.stringify(input)}`);
    assert.ok(
      result.reasons.includes('lead_stage'),
      `expected lead_stage reason for ${JSON.stringify(input)}, got ${describeResult(result)}`
    );
  }
});

test('a lead that converts into a real applicant receives an invite', () => {
  assert.equal(evaluateForStage('lead-new').shouldSend, false);

  for (const stage of LEVER_STAGES.filter((entry) => entry.invite)) {
    const result = evaluateForStage(stage.id);
    assert.equal(result.shouldSend, true, `expected invite at ${stage.name}`);
    assert.deepEqual(result.reasons, []);
  }
});

test('background screening maps to Offer Extended in both label forms', () => {
  const inputs = ['7bac956b-7e4f-4d04-8ed5-d0187274a267', 'Asurint Background Screening', 'Background Check'];

  for (const input of inputs) {
    const fields = resolvePortalStageFields({
      currentStage: resolveCurrentStageLabel(input),
      archived: false,
      archiveReason: null,
    });
    assert.equal(fields.portal_stage, 'Offer Extended', `${input} -> ${fields.portal_stage}`);
  }
});

test('the Hired archive reason resolves to the terminal Hired portal stage', () => {
  const fields = resolvePortalStageFields({
    currentStage: resolveCurrentStageLabel('offer'),
    archived: true,
    archiveReason: normalizeArchiveReason('065bdabc-f3ac-4bf3-8f95-368a0193996a'),
  });

  assert.equal(fields.portal_stage, 'Hired');
  assert.equal(fields.portal_stage_order, 99);
  assert.equal(fields.portal_stage_terminal, true);
});

test('archived candidates are never invited regardless of stage', () => {
  for (const stage of LEVER_STAGES.filter((entry) => entry.invite)) {
    const result = evaluateForStage(stage.id, { archived: true });
    assert.equal(result.shouldSend, false, `expected suppression when archived at ${stage.name}`);
    assert.ok(result.reasons.includes('archived'));
  }
});

test('decline and archived candidates are blocked', () => {
  const declined = evaluateForStage('f3a6f8ba-4ad7-4fe0-ba59-3775ea5ea8af');
  assert.equal(declined.shouldSend, false);
  assert.ok(declined.reasons.includes('decline_stage'));

  const archived = evaluateForStage('Interview', { archived: true });
  assert.equal(archived.shouldSend, false);
  assert.ok(archived.reasons.includes('archived'));
});

test('invite_sent_at enforces a single send', () => {
  const result = evaluateForStage('Interview', { inviteAlreadySent: true });
  assert.equal(result.shouldSend, false);
  assert.ok(result.reasons.includes('invite_already_sent'));
});

test('unmapped stages fail closed rather than emailing an unknown stage', () => {
  const result = evaluateForStage('11111111-2222-3333-4444-555555555555');
  assert.equal(result.shouldSend, false);
  assert.ok(result.reasons.includes('unrecognized_stage'));
});

test('missing contact factors still block the send', () => {
  const noPhone = evaluateForStage('Interview', { applicationPhone: null });
  assert.equal(noPhone.shouldSend, false);
  assert.ok(noPhone.reasons.includes('missing_valid_application_phone'));

  const noEmail = evaluateForStage('Interview', { recipientEmail: '  ' });
  assert.equal(noEmail.shouldSend, false);
  assert.ok(noEmail.reasons.includes('missing_recipient_email'));
});

test('lead detection matches the lead vocabulary without false positives', () => {
  assert.equal(isLeadStage('New Lead'), true);
  assert.equal(isLeadStage('lead-anything'), true);
  assert.equal(isLeadStage('Lead'), true);
  assert.equal(isLeadStage('Leadership Role'), false);
  assert.equal(isLeadStage('Lead Engineer'), false);
  assert.equal(isLeadStage(null), false);

  assert.equal(isDeclineStage('Decline Candidate'), true);
  assert.equal(isDeclineStage('Interview'), false);

  assert.equal(isInviteEligibleStage('New Lead'), false);
  assert.equal(isInviteEligibleStage('Decline Candidate'), false);
  assert.equal(isInviteEligibleStage('Interview'), true);
  assert.equal(isInviteEligibleStage('totally-unknown-stage'), false);
});

const { randomUUID } = require("crypto");

function asString(value) {
  return String(value == null ? "" : value).trim();
}

function normalizeEmail(value) {
  const email = asString(value).toLowerCase();
  if (!email || !email.includes("@")) return null;

  const parts = email.split("@");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return email;
}

function normalizePhone10(value) {
  let digits = String(value == null ? "" : value).replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  return /^\d{10}$/.test(digits) ? digits : null;
}

function normalizeLastName(value) {
  const lastName = asString(value).toLowerCase();
  return lastName || null;
}

function normalizeLeverCandidateId(value) {
  const id = asString(value).toLowerCase();
  return id || null;
}

function normalizeLeverOpportunityId(value) {
  const id = asString(value).toLowerCase();
  return id || null;
}

function extractLastName(fullName) {
  const name = asString(fullName);
  if (!name) return null;
  const parts = name.split(/\s+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : null;
}

function buildIdentityFields({ email, phone, fullName, leverCandidateId, leverOpportunityId }) {
  const normalizedEmail = normalizeEmail(email);
  const normalizedPhone = normalizePhone10(phone);
  const normalizedLeverCandidateId = normalizeLeverCandidateId(leverCandidateId);
  const normalizedLeverOpportunityId = normalizeLeverOpportunityId(leverOpportunityId);
  const applicationLastName = extractLastName(fullName);

  if (normalizedEmail) {
    return {
      normalizedEmail,
      normalizedPhone,
      person_key: `email:${normalizedEmail}`,
      identity_confidence: 3,
      application_phone: normalizedPhone,
      application_last_name: applicationLastName,
      application_last_name_norm: normalizeLastName(applicationLastName),
    };
  }

  if (normalizedPhone) {
    return {
      normalizedEmail,
      normalizedPhone,
      normalizedLeverCandidateId,
      person_key: `phone:${normalizedPhone}`,
      identity_confidence: 2,
      application_phone: normalizedPhone,
      application_last_name: applicationLastName,
      application_last_name_norm: normalizeLastName(applicationLastName),
    };
  }

  if (normalizedLeverCandidateId) {
    return {
      normalizedEmail,
      normalizedPhone,
      normalizedLeverCandidateId,
      normalizedLeverOpportunityId,
      person_key: `lever_candidate:${normalizedLeverCandidateId}`,
      identity_confidence: 1,
      application_phone: null,
      application_last_name: applicationLastName,
      application_last_name_norm: normalizeLastName(applicationLastName),
    };
  }

  if (normalizedLeverOpportunityId) {
    return {
      normalizedEmail,
      normalizedPhone,
      normalizedLeverCandidateId,
      normalizedLeverOpportunityId,
      person_key: `lever_opportunity:${normalizedLeverOpportunityId}`,
      identity_confidence: 1,
      application_phone: null,
      application_last_name: applicationLastName,
      application_last_name_norm: normalizeLastName(applicationLastName),
    };
  }

  return {
    normalizedEmail,
    normalizedPhone,
    normalizedLeverCandidateId,
    normalizedLeverOpportunityId,
    person_key: null,
    identity_confidence: 1,
    application_phone: null,
    application_last_name: applicationLastName,
    application_last_name_norm: normalizeLastName(applicationLastName),
  };
}

async function resolveMagicToken(
  { personKey, existingApplicationToken },
  { findMagicTokenByPersonKey, generateToken = randomUUID }
) {
  if (personKey) {
    const existing = await findMagicTokenByPersonKey(personKey);
    return existing || existingApplicationToken || generateToken();
  }

  return existingApplicationToken || generateToken();
}

module.exports = {
  normalizeEmail,
  normalizePhone10,
  normalizeLastName,
  normalizeLeverCandidateId,
  extractLastName,
  buildIdentityFields,
  resolveMagicToken,
};
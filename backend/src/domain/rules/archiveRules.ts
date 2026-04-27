export interface ArchiveInputs {
  currentStage: string | null;
  archived: boolean;
  archiveReason: string | null;
}

export interface ArchiveProjection {
  portalStage: string | null;
  portalStageOrder: number | null;
  portalStageTerminal: boolean;
}

export function resolveArchiveProjection(input: ArchiveInputs): ArchiveProjection {
  const stage = (input.currentStage || "").trim().toLowerCase();
  const reason = (input.archiveReason || "").trim().toLowerCase();

  if (input.archived && (reason === "hired" || reason.includes("hire"))) {
    return { portalStage: "Hired", portalStageOrder: 99, portalStageTerminal: true };
  }

  if (input.archived || stage === "decline candidate") {
    return {
      portalStage: "Application Closed",
      portalStageOrder: 0,
      portalStageTerminal: true,
    };
  }

  if (stage === "new applicant") {
    return {
      portalStage: "Application Received",
      portalStageOrder: 10,
      portalStageTerminal: false,
    };
  }

  if (stage === "review" || stage === "request phone screen") {
    return {
      portalStage: "Under Review",
      portalStageOrder: 20,
      portalStageTerminal: false,
    };
  }

  if (
    stage === "phone screen" ||
    stage === "virtual interview" ||
    stage === "interview" ||
    stage === "second interview" ||
    stage === "third interview"
  ) {
    return {
      portalStage: "Interviewing",
      portalStageOrder: 30,
      portalStageTerminal: false,
    };
  }

  if (stage === "reference check" || stage === "requisition") {
    return {
      portalStage: "Decision in Progress",
      portalStageOrder: 40,
      portalStageTerminal: false,
    };
  }

  if (stage === "offer" || stage === "background check") {
    return {
      portalStage: "Offer Extended",
      portalStageOrder: 50,
      portalStageTerminal: false,
    };
  }

  if (stage === "new lead" || stage === "reached out" || stage === "responded") {
    return {
      portalStage: null,
      portalStageOrder: null,
      portalStageTerminal: false,
    };
  }

  return {
    portalStage: "Under Review",
    portalStageOrder: 20,
    portalStageTerminal: false,
  };
}

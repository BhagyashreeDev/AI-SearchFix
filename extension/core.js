import { BACKEND_ORIGIN } from "./deployment.js";

export const DOCUMENT_TYPES = [
    "TA",
    "SEARCH_PACKAGE",
    "TAX",
    "PA",
    "LEGAL_DESCRIPTION",
    "MAP",
    "LIEN",
    "PACER",
    "PATRIOT",
    "TYPED_REPORT",
    "COST_WORKSHEET",
    "THR",
    "INDEX", "ATTORNEY_OPINION", "VENDOR_MANAGEMENT", "HOA_DOCUMENT",
    "PROPERTY_REPORT", "LIEN_REGISTRY", "COVER_SHEET", "CHECKLIST"
];

export const DEFAULT_SETTINGS = {
  backend: BACKEND_ORIGIN,
  order: "[id$='_lblServiceProviderOrderNumber'], [data-order-number]",
  comments: "[id$='_OrderCommentControl1_dgComments'], [data-searchfix-comments], #comments, #order-comments",
  commentRow: "[data-comment], tbody tr",
  author: "[data-author], .comment-author",
  date: "[data-date], .comment-date",
  time: "[data-time], .comment-time",
  text: "[data-comment-text], .comment-text",
  attachments: "[data-attachments], #attachments",
  taRead: "[data-typing-assistant], #typing-assistant"
};

export function backendURL(value, configuredOrigin = BACKEND_ORIGIN) {
  const url = new URL(value);
  const local = ["http://localhost:3000", "http://127.0.0.1:3000"];
  const allowed = local.includes(configuredOrigin) ? local : [configuredOrigin];
  if (!allowed.includes(url.origin) || (!local.includes(url.origin) && url.protocol !== "https:") || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("The analysis service must match the address packaged with this extension and use HTTPS when hosted.");
  }
  return url.origin;
}

export function guessDocumentType(name) {
  const words = name.toUpperCase().replace(/[^A-Z0-9]+/g, " ");
  const rules = [
    [/\bTYPING ?ASSISTANT\b/, "TA"],
    [/\b(ATTORNEY(?: S)?(?: TITLE)? OPINION|AO|ATO)\b/, "ATTORNEY_OPINION"],
    [/\b(VENDOR ?MANAGEMENT|VENDOR ?INSTRUCTIONS?|VENDOR ?REQUIREMENTS?|VM|ORIGINAL ?REQUEST|SPECIAL ?REQUIREMENTS?|CLIENT ?REQUIREMENTS?|CLIENT ?INSTRUCTIONS?|ORDER ?INSTRUCTIONS?|REAL ?ESTATE ?REQUEST(?: FORM)?|REQUEST ?FORM|GUIDELINES)\b/, "VENDOR_MANAGEMENT"],
    [/\b(HOA|HOMEOWNERS? ASSOCIATION)\b/, "HOA_DOCUMENT"],
    [/\bPROPERTY (?:VIEW )?REPORT\b/, "PROPERTY_REPORT"],
    [/\bLIEN REGISTR[YI]\b/, "LIEN_REGISTRY"],
    [/\b(COVER ?SHEET|RUN ?SHEET)\b/, "COVER_SHEET"],
    [/\bCHECK ?LIST\b/, "CHECKLIST"],
    [/\b(TYPED|REPORT TYPED|TYPING|TA)\b/, "TYPED_REPORT"],
    [/\b(PACER|BANKRUPTCY)\b/, "PACER"], [/\bPATRIOT\b/, "PATRIOT"],
    [/\b(THR|TRANSACTION ?HISTORY)\b/, "THR"],
    [/\bTAX\b/, "TAX"], [/\b(PA|PASANP|PASNAP|PASNAPSHOT|PROPERTY ASSESSMENT)\b/, "PA"],
    [/\bLEGAL\b/, "LEGAL_DESCRIPTION"], [/\b(MAP|PLAT)\b/, "MAP"],
    [/\bLIEN\b/, "LIEN"], [/\bCOST\b/, "COST_WORKSHEET"],
    [/\b(SEARCH ?INDEX|SEARCH ?INDEXES|INDEX|INDEXES)\b/, "INDEX"],
    [/\bSEARCH ?PACKAGE\b/, "SEARCH_PACKAGE"]
  ];
  return rules.find(([pattern]) => pattern.test(words))?.[1] || "";
}

export function parseRecencyScore(file) {
  if (typeof file?.timestamp === 'number' && !isNaN(file.timestamp)) return file.timestamp;
  const name = file?.name || "";
  const uploadDate = file?.uploadDate || file?.attachedDate || file?.date || "";
  if (uploadDate) {
    const combined = file?.attachedTime ? `${uploadDate} ${file.attachedTime}` : uploadDate;
    const parsed = Date.parse(combined);
    if (!isNaN(parsed)) return parsed;
  }
  const iso = name.match(/(20\d{2})[-_./](\d{1,2})[-_./](\d{1,2})/);
  if (iso) {
    const t = new Date(`${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`).getTime();
    if (!isNaN(t)) return t;
  }
  const us = name.match(/(\d{1,2})[-_./](\d{1,2})[-_./](20\d{2})/);
  if (us) {
    const t = new Date(`${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`).getTime();
    if (!isNaN(t)) return t;
  }
  const ver = name.match(/(?:[_\b]v|version|rev)[-_.]?(\d+)/i);
  if (ver) return Number(ver[1]) * 1000;
  return 0;
}

export function requiredTypes(result) {
  return [...new Set((result.issues || []).flatMap(issue => (issue.requiredFiles || []).map(file => file.fileType)))];
}

export function suggestedComment(result) {
  const status = result.overallDecision || result.status;
  if (!['ACCEPTED','DISPUTED'].includes(status)) return null;
  const clean = value => typeof value === 'string' ? value.replace(/\b(?:accept(?:ed)?|disput(?:e|ed))\b\s*:?/gi,'').trim() : '';
  const issues = (result.issues || []).filter(issue => ['ACCEPTED','DISPUTED'].includes(issue.decision));
  const text = issues.map(issue => clean(issue.commentSuggestion) || clean(issue.reason)).filter(Boolean).join('\n\n') || clean(result.reason) || (result.nextSteps || []).map(clean).filter(Boolean).join('\n');
  if (!text) return null;
  return {text, needsCompletion: status === 'ACCEPTED' && result.decisionBasis !== 'CLIENT_TASK',
    hasPendingReview: (result.issues || []).some(issue => issue.decision === 'REVIEW_REQUIRED')};
}

export function validateOrder(order) {
  if (!order.orderNumber?.trim()) throw new Error("Order number was not found. Set its page selector or enter it below.");
  if (!Array.isArray(order.comments) || !order.comments.length) throw new Error("No comments found. Open Order Overview and expand comments, or configure the comment selectors.");
  if (order.comments.some(c => !c.text?.trim() || !c.author?.trim())) throw new Error("Every comment needs text and an author. Correct the page selectors before analysis.");
  if (order.comments.some(c => !/^\d{4}-\d{2}-\d{2}$/.test(c.date || "") || !/^\d{2}:\d{2}(:\d{2})?$/.test(c.time || ""))) {
    throw new Error("Comment dates and times are incomplete or ambiguous. The backend needs YYYY-MM-DD and 24-hour times to select the latest comment correctly.");
  }
  return { orderNumber: order.orderNumber.trim(), comments: order.comments };
}

export function buildAssistantText(result) {
  const lines = [`SearchFix review — ${result.orderNumber}`, ""];
  const decision = result.overallDecision || result.status;
  if (decision) lines.push(`Status: ${decision.replaceAll("_", " ")}`, "");
  if (result.reason) lines.push(result.reason, "");
  const selected = result.commentAnalysis?.selectedComment;
  if (selected) lines.push(`Comment reviewed (${selected.author || "Unknown"}):`, selected.text, "");
  if (result.commentAnalysis?.selectionReason) lines.push(`Why AI chose it: ${result.commentAnalysis.selectionReason}`, `Author interpretation: ${result.commentAnalysis.roleReason || selected?.role || "Unknown"}`, "");
  if (result.decisionBasis === "CLIENT_TASK") lines.push("Client task acknowledged for human action; no document error has been established.", "");
  if (decision === "IGNORED") {
    lines.push("Order ignored. No supporting documents were analyzed; select another order when ready.");
  } else {
    for (const [index, issue] of (result.issues || []).entries()) {
      lines.push(`${index + 1}. What the client needs: ${issue.claim || issue.clientClaim}`);
      if (issue.nextSteps?.length) lines.push("Next steps:", ...issue.nextSteps.map(step=>`- ${step}`));
      if (issue.category) lines.push(`Category: ${issue.category}`);
      if (issue.decision) lines.push(`Assessment: ${issue.decision.replaceAll("_", " ")}`, issue.reason || "");
      if (issue.requiredFiles?.length) lines.push(`Files to check: ${issue.requiredFiles.map(f => f.fileType.replaceAll("_", " ")).join(", ")}`);
      for (const evidence of issue.evidence || []) {
        lines.push(`Evidence — ${evidence.document}${evidence.page ? `, page ${evidence.page}` : " (page not identified)"}: ${evidence.finding}`);
        if (evidence.quotedText) lines.push(`Quote: ${evidence.quotedText}`);
      }
      lines.push("");
    }
    if (result.status === "AWAITING_DOCUMENTS") lines.push("Next step: review the relevant attachments below. The client's request has not yet been verified against documents.");
    else lines.push("Next step: check the cited evidence and any REVIEW REQUIRED items before deciding what to tell the client.");
  }
  for (const document of result.documents || []) lines.push(`Document: ${document.name} — ${document.status.replaceAll("_", " ")}`);
  if (result.nextSteps?.length) lines.push("", "Next steps:", ...result.nextSteps.map(step=>`- ${step}`));
  lines.push("", "Review notes only. No order fields, files, comments, or website Typing Assistant content have been changed.");
  return lines.join("\n");
}

// Look inside a bundle when a requested standalone source is unavailable.
// TA and the actual Typed Report always remain separate, explicit sources.
// If multiple attachments exist for the same document type, the most recent one is chosen.
export function selectEvidenceAttachments(attachments, required, issues = []) {
  const files = [...new Map(attachments.map(file => [file.url, { ...file, type: guessDocumentType(file.name) }])).values()];
  const preferred = files.filter(file => !/\.docx?$/i.test(file.name) || !files.some(other => /\.pdf$/i.test(other.name) && other.name.replace(/\.pdf$/i, '').toLowerCase() === file.name.replace(/\.docx?$/i, '').toLowerCase()));
  
  const deedIssues = new Set(['MISSING_DEED', 'DEED_DISCREPANCY', 'VESTING_DISCREPANCY', 'CHAIN_BREAK', 'LENDER_NAME_DISCREPANCY']);
  const needsDeed = issues.some(issue => deedIssues.has(issue.issueType) || /\bdeed\b/i.test(issue.claim || issue.clientClaim || ''));
  const deeds = needsDeed ? preferred.filter(file => !file.type && /\bdeed\b/i.test(file.name.replace(/[_-]/g, ' ')) && !/\b(?:trust|mortgage)\b/i.test(file.name)) : [];
  
  // Sort matching candidates by recency descending
  const packageNeeded = issues.some(issue => !deedIssues.has(issue.issueType) && (issue.requiredFiles || []).some(f => f.fileType === 'SEARCH_PACKAGE'));
  const candidateFiles = preferred.filter(file => file.type !== 'TA' && required.includes(file.type) && !(file.type === 'SEARCH_PACKAGE' && deeds.length && !packageNeeded));
  
  // Check for explicit filenames recommended by backend AI analysis
  const explicitFiles = preferred.filter(file => 
    issues.some(issue => (issue.requiredFiles || []).some(rf => rf.fileName && rf.fileName.toLowerCase() === file.name.toLowerCase() && !['TYPED REPORT', 'TYPING ASSISTANT'].includes(rf.fileName)))
  );

  // Group by document type and sort each group by recency descending
  const selected = [];
  const typeGroups = new Map();
  for (const file of candidateFiles) {
    if (!typeGroups.has(file.type)) typeGroups.set(file.type, []);
    typeGroups.get(file.type).push(file);
  }
  for (const [type, group] of typeGroups.entries()) {
    if (group.length > 1) {
      group.sort((a, b) => parseRecencyScore(b) - parseRecencyScore(a));
      // For package/report bundles, pick the most recent one
      if (['SEARCH_PACKAGE', 'PROPERTY_REPORT', 'TYPED_REPORT'].includes(type)) {
        selected.push(group[0]);
        continue;
      }
    }
    selected.push(...group);
  }

  selected.unshift(...deeds.map(file => ({ ...file, type: 'SEARCH_PACKAGE' })));
  
  const needsBundle = required.some(type => !['TA', 'TYPED_REPORT'].includes(type) && !selected.some(file => file.type === type));
  if (needsBundle) {
    const packages = preferred.filter(file => file.type === 'SEARCH_PACKAGE');
    const bundles = packages.length ? packages : preferred.filter(file => file.type === 'PROPERTY_REPORT');
    if (bundles.length > 1) bundles.sort((a, b) => parseRecencyScore(b) - parseRecencyScore(a));
    for (const file of bundles) {
      if (!selected.some(other => other.url === file.url)) {
        selected.push(file);
        break; // Pick the most recent bundle
      }
    }
  }
  return selected;
}

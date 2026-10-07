import { DOCUMENT_TYPES, getRequiredDocumentTypes } from "../config/documentMappings.js";

export function guessDocumentType(name) {
    if (!name || typeof name !== "string") return "";
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
        [/\b(PACER|BANKRUPTCY)\b/, "PACER"],
        [/\bPATRIOT\b/, "PATRIOT"],
        [/\b(THR|TRANSACTION ?HISTORY)\b/, "THR"],
        [/\bTAX\b/, "TAX"],
        [/\b(PA|PASANP|PASNAP|PASNAPSHOT|PROPERTY ASSESSMENT)\b/, "PA"],
        [/\bLEGAL\b/, "LEGAL_DESCRIPTION"],
        [/\b(MAP|PLAT)\b/, "MAP"],
        [/\bLIEN\b/, "LIEN"],
        [/\bCOST\b/, "COST_WORKSHEET"],
        [/\b(SEARCH ?INDEX|SEARCH ?INDEXES|INDEX|INDEXES)\b/, "INDEX"],
        [/\bSEARCH ?PACKAGE\b/, "SEARCH_PACKAGE"]
    ];
    return rules.find(([pattern]) => pattern.test(words))?.[1] || "";
}

export function parseRecencyScore(file) {
    if (typeof file?.timestamp === 'number' && !isNaN(file.timestamp)) return file.timestamp;
    const name = file?.fileName || file?.name || "";
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

export class DocumentSelectionService {
    /**
     * Finds the best matching attachment filename from available attachments for a given document type.
     * Prioritizes the most recent attachment when duplicates exist.
     * If TYPED_REPORT is not found in attachments, returns "TYPED REPORT".
     * If TA is not found in attachments, returns "TYPING ASSISTANT".
     */
    findBestAttachmentForType(docType, availableAttachments = []) {
        if (!Array.isArray(availableAttachments) || availableAttachments.length === 0) {
            if (docType === "TYPED_REPORT") return "TYPED REPORT";
            if (docType === "TA") return "TYPING ASSISTANT";
            return undefined;
        }

        const matches = availableAttachments.filter(att => {
            const name = att.fileName || att.name || "";
            if (docType === "TA" && (att.isTxt || name.toLowerCase().endsWith(".txt") || /\btyping\s*assistant\b/i.test(name))) {
                return true;
            }
            return guessDocumentType(name) === docType;
        });

        if (matches.length > 0) {
            matches.sort((a, b) => parseRecencyScore(b) - parseRecencyScore(a));
            return matches[0].fileName || matches[0].name;
        }

        if (docType === "TYPED_REPORT") return "TYPED REPORT";
        if (docType === "TA") return "TYPING ASSISTANT";
        return undefined;
    }

    /**
     * Determines required document types dynamically based on AI classification and global document knowledge.
     * 
     * @param {Array<{issueType: string, claim: string, requiredDocuments?: Array<string>, targetAttachmentNames?: Array<string>, decision?: string, reason?: string}>} issues List of issues
     * @param {Array<Object>} availableAttachments Optional list of available attachments manifest
     * @returns {Array<{issueType: string, claim: string, requiredDocuments: Array<string>, targetAttachmentNames?: Array<string>, reason?: string}>} Issues with required documents attached
     */
    selectRequiredDocuments(issues, availableAttachments = []) {
        if (!Array.isArray(issues)) return [];

        return issues.map(issue => {
            let requiredDocs = [];
            if (Array.isArray(issue.requiredDocuments) && issue.requiredDocuments.length > 0) {
                requiredDocs = issue.requiredDocuments.filter(docType => DOCUMENT_TYPES.includes(docType));
            } else if (issue.issueType) {
                requiredDocs = getRequiredDocumentTypes(issue.issueType);
            }

            // Deduplicate and ensure TA is included when TYPED_REPORT is requested for comparison
            const finalDocs = [...new Set(requiredDocs.includes("TYPED_REPORT") ? [...requiredDocs, "TA"] : requiredDocs)];

            return {
                ...issue,
                decision: undefined, // Clear any premature decision; final decision occurs in Step 2
                requiredDocuments: finalDocs
            };
        });
    }
}

export const documentSelectionService = new DocumentSelectionService();

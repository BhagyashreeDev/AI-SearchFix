export class EvidenceService {
    /**
     * Sanitizes and structures evidence items for issue decision evaluation.
     * 
     * @param {Array<object>} rawEvidence Raw evidence objects
     * @returns {Array<object>} Traceable evidence items
     */
    formatEvidence(rawEvidence) {
        if (!Array.isArray(rawEvidence)) return [];

        return rawEvidence.map(item => ({
            documentTypes: item.documentTypes || [],
            document: item.document || "Unspecified Document",
            page: typeof item.page === "number" ? item.page : null,
            field: item.field || "",
            value: item.value || "",
            finding: (item.finding || "").trim(),
            quotedText: item.quotedText || "",
            confidence: typeof item.confidence === "number" ? item.confidence : 0.9
        }));
    }
}

export const evidenceService = new EvidenceService();

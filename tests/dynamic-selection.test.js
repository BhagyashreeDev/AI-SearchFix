import test from 'node:test';
import assert from 'node:assert/strict';
import { DOCUMENT_TYPES, selectEvidenceAttachments, parseRecencyScore } from '../extension/core.js';
import { documentSelectionService } from '../src/services/documentSelection.service.js';
import { issueClassificationService } from '../src/services/issueClassification.service.js';
import { geminiService } from '../src/services/gemini.service.js';

test('Global document ontology includes all 20 standardized title examination types', () => {
    assert.equal(DOCUMENT_TYPES.length, 20);
    const expected = [
        "TA", "SEARCH_PACKAGE", "TAX", "PA", "LEGAL_DESCRIPTION",
        "MAP", "LIEN", "PACER", "PATRIOT", "TYPED_REPORT",
        "COST_WORKSHEET", "THR", "INDEX", "ATTORNEY_OPINION",
        "VENDOR_MANAGEMENT", "HOA_DOCUMENT", "PROPERTY_REPORT",
        "LIEN_REGISTRY", "COVER_SHEET", "CHECKLIST"
    ];
    for (const type of expected) {
        assert.ok(DOCUMENT_TYPES.includes(type), `Expected DOCUMENT_TYPES to include ${type}`);
    }
});

test('DocumentSelectionService dynamically assigns AI-chosen document requirements', () => {
    const issues = [
        {
            issueType: 'VESTING_DISCREPANCY',
            claim: 'Vesting does not match deed',
            requiredDocuments: ['SEARCH_PACKAGE', 'TYPED_REPORT']
        },
        {
            issueType: 'PARCEL_MISMATCH',
            claim: 'Check tax parcel ID',
            requiredDocuments: ['TAX', 'PA']
        }
    ];

    const result = documentSelectionService.selectRequiredDocuments(issues);
    assert.equal(result.length, 2);
    // When TYPED_REPORT is required, TA is also automatically included for comparison
    assert.deepEqual(result[0].requiredDocuments, ['SEARCH_PACKAGE', 'TYPED_REPORT', 'TA']);
    assert.deepEqual(result[1].requiredDocuments, ['TAX', 'PA']);
});

test('Recency score correctly ranks attachments by date and version', () => {
    const older = { name: '2026-09-20_SearchPackage.pdf', uploadDate: '2026-09-20' };
    const newer = { name: '2026-09-25_SearchPackage.pdf', uploadDate: '2026-09-25' };
    const v1 = { name: 'TypedReport_v1.pdf' };
    const v2 = { name: 'TypedReport_v2.pdf' };

    assert.ok(parseRecencyScore(newer) > parseRecencyScore(older));
    assert.ok(parseRecencyScore(v2) > parseRecencyScore(v1));
});

test('selectEvidenceAttachments prioritizes the most recent Search Package when duplicates exist', () => {
    const attachments = [
        { name: '2026-09-20_SearchPackage.pdf', url: 'https://tv.datatracetitle.com/att1.pdf' },
        { name: '2026-09-25_SearchPackage.pdf', url: 'https://tv.datatracetitle.com/att2.pdf' }
    ];
    const issues = [{ issueType: 'SEARCH_PACKAGE_DISCREPANCY', requiredFiles: [{ fileType: 'SEARCH_PACKAGE' }] }];
    const selected = selectEvidenceAttachments(attachments, ['SEARCH_PACKAGE'], issues);
    
    assert.equal(selected.length, 1);
    assert.equal(selected[0].name, '2026-09-25_SearchPackage.pdf');
});

test('Missing document claim against available attachments returns direct terminal decision', async () => {
    const originalJSON = geminiService.generateJSON;
    try {
        // Mock AI returning DISPUTED because PACER is in available attachments
        geminiService.generateJSON = async () => ({
            selectedCommentId: 'C1',
            selectedRole: 'CLIENT',
            contextCommentIds: [],
            selectionReason: 'Client claims PACER is missing.',
            roleReason: 'Author is Outsource client.',
            disposition: 'DISPUTED',
            reason: 'PACER bankruptcy search is already attached in the order file.',
            nextSteps: ['PACER is already present.'],
            issues: [{
                issueType: 'PACER_SEARCH_DISCREPANCY',
                claim: 'Missed to attach PACER. Please advise.',
                decision: 'DISPUTED',
                reason: 'PACER search report is attached.'
            }]
        });

        const comments = [{
            id: 'C1',
            date: '2026-10-06',
            time: '10:00',
            author: 'Outsource User',
            text: 'Missed to attach PACER. Please advise.'
        }];
        const attachments = [{ fileName: 'PACER_Report.pdf', docType: 'PACER' }];

        const route = await issueClassificationService.analyzeComments(comments, attachments);
        assert.equal(route.terminal, 'DISPUTED');
        assert.equal(route.issues[0].decision, 'DISPUTED');
        assert.match(route.reason, /PACER/);
    } finally {
        geminiService.generateJSON = originalJSON;
    }
});

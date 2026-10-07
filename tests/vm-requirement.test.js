import test from 'node:test';
import assert from 'node:assert/strict';
import { guessDocumentType, DOCUMENT_TYPES } from '../extension/core.js';
import { guessDocumentType as backendGuessDocumentType } from '../src/services/documentSelection.service.js';
import { issueClassificationService } from '../src/services/issueClassification.service.js';
import { decisionEngine } from '../src/services/decision.service.js';
import { missingEvidenceTypes } from '../src/services/evidenceCoverage.service.js';
import { geminiService } from '../src/services/gemini.service.js';
import { analyzeCommentsController, analyzeDocumentsController } from '../src/controllers/searchfix.controller.js';

const comment = (author, text, time = '12:00', date = '2026-10-07') => ({ author, text, time, date });
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });

test('guessDocumentType recognizes all vendor management naming variations', () => {
    const testCases = [
        '101-10935805_VM.pdf',
        '101-10935805_VENDOR_MANAGEMENT.pdf',
        '101-10935805_VENDOR_REQUIREMENTS.pdf',
        'Vendor Instructions.pdf',
        'Client_Requirements.pdf',
        'Order_Instructions.pdf',
        'Real_Estate_Request_Form.pdf',
        'Original_Request.pdf',
        'Guidelines.pdf',
        'Special Requirements.pdf'
    ];

    for (const name of testCases) {
        assert.equal(guessDocumentType(name), 'VENDOR_MANAGEMENT', `Frontend guessDocumentType failed for ${name}`);
        assert.equal(backendGuessDocumentType(name), 'VENDOR_MANAGEMENT', `Backend guessDocumentType failed for ${name}`);
    }
});

test('As per VM requirement comment routes to ANALYZE with VENDOR_MANAGEMENT and target document', async () => {
    const originalJSON = geminiService.generateJSON;
    try {
        geminiService.generateJSON = async (system, user) => {
            assert.match(system, /AS PER VM REQUIREMENT/);
            return {
                selectedCommentId: 'C1',
                selectedRole: 'CLIENT',
                contextCommentIds: [],
                selectionReason: 'Comment C1 is the latest actionable request regarding VM requirement for patriot search.',
                roleReason: 'Author is Outsource client representative.',
                disposition: 'ANALYZE',
                reason: 'Client claims Patriot search is required per VM requirements but not attached.',
                nextSteps: ['Inspect VENDOR_MANAGEMENT document and order attachments to verify Patriot search requirement.'],
                issues: [{
                    issueType: 'PATRIOT_SEARCH_DISCREPANCY',
                    claim: 'Product [Current Owner] (WFID:17790607) As per vm requirement patriot is required but not attached please confirm',
                    requiredDocuments: ['VENDOR_MANAGEMENT', 'PATRIOT']
                }]
            };
        };

        const comments = [{
            id: 'C1',
            date: '2026-10-07',
            time: '07:34',
            author: 'RVSI-Outsource: PVinay_FAI',
            text: 'Product [Current Owner] (WFID:17790607) As per vm requirement patriot is required but not attached please confirm'
        }];

        const attachments = [
            { fileName: '101-10935805_SEARCH PACKAGE.pdf', docType: 'SEARCH_PACKAGE' },
            { fileName: '101-10935805_VM.pdf', docType: 'VENDOR_MANAGEMENT' }
        ];

        const route = await issueClassificationService.analyzeComments(comments, attachments);
        assert.equal(route.terminal, undefined);
        assert.equal(route.issues.length, 1);
        assert.equal(route.issues[0].issueType, 'PATRIOT_SEARCH_DISCREPANCY');
        assert.deepEqual(route.issues[0].requiredDocuments, ['VENDOR_MANAGEMENT', 'PATRIOT']);
    } finally {
        geminiService.generateJSON = originalJSON;
    }
});

test('missingEvidenceTypes allows VM claim evaluation when VENDOR_MANAGEMENT is supplied without target file', () => {
    const issue = {
        issueType: 'PATRIOT_SEARCH_DISCREPANCY',
        claim: 'As per vm requirement patriot is required but not attached please confirm',
        requiredDocuments: ['VENDOR_MANAGEMENT', 'PATRIOT']
    };

    // Case: VENDOR_MANAGEMENT is supplied, but PATRIOT is absent from attachments
    const filesWithVM = [{ fileName: '101-10935805_VM.pdf', fileType: 'VENDOR_MANAGEMENT' }];
    const missingWhenVMPresent = missingEvidenceTypes(issue.requiredDocuments, filesWithVM, [], issue);
    assert.deepEqual(missingWhenVMPresent, [], 'PATRIOT absence should not block evaluation when VM is present');

    // Case: VENDOR_MANAGEMENT is missing
    const filesWithoutVM = [{ fileName: '101-10935805_SEARCH PACKAGE.pdf', fileType: 'SEARCH_PACKAGE' }];
    const missingWhenVMEmpty = missingEvidenceTypes(issue.requiredDocuments, filesWithoutVM, [], issue);
    assert.deepEqual(missingWhenVMEmpty, ['VENDOR_MANAGEMENT'], 'Missing VENDOR_MANAGEMENT must block evaluation');
});

test('VM Matrix Case 1 (ACCEPTED): VM mandates Patriot and Patriot is missing from attachments', async () => {
    const originalJSON = geminiService.generateJSON;
    try {
        geminiService.generateJSON = async (system, user) => {
            assert.match(system, /TWO-STEP VM REQUIREMENT VERIFICATION MATRIX/);
            return {
                decision: 'ACCEPTED',
                reason: 'The Vendor Management document (101-10935805_VM.pdf, page 1) explicitly mandates a Patriot/OFAC search for all orders. The Patriot search report was omitted from attachments.',
                nextSteps: ['Run Patriot search for borrower and attach the Patriot report to the order.'],
                commentSuggestion: 'Patriot search has been performed and attached as required.'
            };
        };

        const issue = {
            issueType: 'PATRIOT_SEARCH_DISCREPANCY',
            claim: 'As per vm requirement patriot is required but not attached please confirm',
            requiredDocuments: ['VENDOR_MANAGEMENT', 'PATRIOT']
        };

        const evidence = [{
            document: '101-10935805_VM.pdf',
            page: 1,
            field: 'patriotRequirement',
            value: 'Mandatory',
            finding: 'Vendor Management specifies that Patriot/OFAC search is mandatory for all products.',
            quotedText: 'PATRIOT SEARCH: REQUIRED FOR ALL PRODUCTS'
        }];

        const result = await decisionEngine.evaluateIssueDecision(issue, evidence);
        assert.equal(result.decision, 'ACCEPTED');
        assert.match(result.reason, /mandates/i);
        assert.match(result.commentSuggestion, /Patriot search/i);
    } finally {
        geminiService.generateJSON = originalJSON;
    }
});

test('VM Matrix Case 2 (DISPUTED): VM mandates Patriot, and Patriot is already attached in the order', async () => {
    const originalJSON = geminiService.generateJSON;
    try {
        geminiService.generateJSON = async (system, user) => {
            return {
                decision: 'DISPUTED',
                reason: 'The Patriot search report is already attached in the order file (101-10935805_PATRIOT.pdf, page 1).',
                nextSteps: ['Cite 101-10935805_PATRIOT.pdf showing Patriot search is already attached.'],
                commentSuggestion: 'Patriot search was completed and attached in the order file under 101-10935805_PATRIOT.pdf.'
            };
        };

        const issue = {
            issueType: 'PATRIOT_SEARCH_DISCREPANCY',
            claim: 'As per vm requirement patriot is required but not attached please confirm',
            requiredDocuments: ['VENDOR_MANAGEMENT', 'PATRIOT']
        };

        const evidence = [
            {
                document: '101-10935805_VM.pdf',
                page: 1,
                field: 'patriotRequirement',
                value: 'Mandatory',
                finding: 'VM mandates Patriot search.',
                quotedText: 'PATRIOT SEARCH: REQUIRED'
            },
            {
                document: '101-10935805_PATRIOT.pdf',
                page: 1,
                field: 'patriotResult',
                value: '0 Found',
                finding: 'Patriot search was completed on 2026-10-06.',
                quotedText: 'Patriot Search Report: 0 records found'
            }
        ];

        const result = await decisionEngine.evaluateIssueDecision(issue, evidence);
        assert.equal(result.decision, 'DISPUTED');
        assert.match(result.reason, /already attached/i);
    } finally {
        geminiService.generateJSON = originalJSON;
    }
});

test('VM Matrix Case 3 (DISPUTED): VM document does NOT mandate Patriot search for this product', async () => {
    const originalJSON = geminiService.generateJSON;
    try {
        geminiService.generateJSON = async (system, user) => {
            return {
                decision: 'DISPUTED',
                reason: 'The Vendor Management request form (101-10935805_VM.pdf, page 1) confirms this is a Current Owner search product. Per client guidelines, Patriot search is only required on Full / Two Owner products and is not mandated for Current Owner searches.',
                nextSteps: ['Inform client that Patriot search is not required for Current Owner product per VM specs.'],
                commentSuggestion: 'Per VM guidelines on page 1 of the Request Form, Patriot search is not required for Current Owner products.'
            };
        };

        const issue = {
            issueType: 'PATRIOT_SEARCH_DISCREPANCY',
            claim: 'As per vm requirement patriot is required but not attached please confirm',
            requiredDocuments: ['VENDOR_MANAGEMENT', 'PATRIOT']
        };

        const evidence = [{
            document: '101-10935805_VM.pdf',
            page: 1,
            field: 'productSpecs',
            value: 'Current Owner Search',
            finding: 'VM document shows Current Owner product with no Patriot search requirement.',
            quotedText: 'Product: Current Owner. Patriot: Optional/Not Required.'
        }];

        const result = await decisionEngine.evaluateIssueDecision(issue, evidence);
        assert.equal(result.decision, 'DISPUTED');
        assert.match(result.reason, /not mandated|not required/i);
    } finally {
        geminiService.generateJSON = originalJSON;
    }
});

test('VM Matrix Case 4 (REVIEW_REQUIRED): VM document was not supplied', async () => {
    const issue = {
        issueType: 'PATRIOT_SEARCH_DISCREPANCY',
        claim: 'As per vm requirement patriot is required but not attached please confirm',
        requiredDocuments: ['VENDOR_MANAGEMENT', 'PATRIOT']
    };

    const result = await decisionEngine.evaluateIssueDecision(issue, []);
    assert.equal(result.decision, 'REVIEW_REQUIRED');
    assert.match(result.reason, /were not provided/i);
});

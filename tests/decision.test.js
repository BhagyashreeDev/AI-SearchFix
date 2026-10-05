import { decisionEngine } from "../src/services/decision.service.js";

async function runDecisionEngineTests() {
    console.log("==========================================");
    console.log("RUNNING DECISION ENGINE TESTS");
    console.log("==========================================");

    let passed = 0;
    let total = 0;

    // Test 1: Empty Evidence -> REVIEW_REQUIRED
    total++;
    try {
        const issue = {
            issueType: "MISSING_DEED",
            claim: "Missing 1979 deed",
            requiredDocuments: ["SEARCH_PACKAGE"]
        };

        const res = await decisionEngine.evaluateIssueDecision(issue, []);
        if (res.decision === "REVIEW_REQUIRED" && res.reason.includes("were not provided")) {
            console.log("✓ Empty evidence -> REVIEW_REQUIRED test passed.");
            passed++;
        } else {
            console.error("✗ Empty evidence test failed:", res);
        }
    } catch (e) {
        console.error("✗ Empty evidence test threw error:", e.message);
    }

    // Test 2: Overall Decision Aggregation (ACCEPTED + REVIEW_REQUIRED -> ACCEPTED)
    total++;
    try {
        const issueResults = [
            { decision: "ACCEPTED" },
            { decision: "REVIEW_REQUIRED" }
        ];

        const overall = decisionEngine.calculateOverallDecision(issueResults);
        if (overall === "ACCEPTED") {
            console.log("✓ Overall decision aggregation (ACCEPTED priority) test passed.");
            passed++;
        } else {
            console.error("✗ Overall decision aggregation failed:", overall);
        }
    } catch (e) {
        console.error("✗ Overall decision aggregation threw error:", e.message);
    }

    // Test 3: Overall Decision Aggregation (Only REVIEW_REQUIRED -> REVIEW_REQUIRED)
    total++;
    try {
        const issueResults = [
            { decision: "REVIEW_REQUIRED" },
            { decision: "DISPUTED" }
        ];

        const overall = decisionEngine.calculateOverallDecision(issueResults);
        if (overall === "REVIEW_REQUIRED") {
            console.log("✓ Overall decision aggregation (REVIEW_REQUIRED priority over DISPUTED) test passed.");
            passed++;
        } else {
            console.error("✗ Overall decision aggregation failed:", overall);
        }
    } catch (e) {
        console.error("✗ Overall decision aggregation threw error:", e.message);
    }

    console.log(`Decision Engine Tests Complete: ${passed}/${total} passed.\n`);
    if (passed !== total) process.exitCode = 1;
}

runDecisionEngineTests();

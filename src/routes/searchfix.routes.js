import { Router } from "express";
import multer from "multer";
import os from "os";
import { analyzeCommentsController, analyzeDocumentsController, analyzeFullOrder } from "../controllers/searchfix.controller.js";
import { geminiKeyMiddleware, withRequestGeminiKey } from "../services/geminiContext.service.js";
import { geminiService } from "../services/gemini.service.js";
import { receiveClientDiagnostics } from '../services/clientDiagnostics.service.js';

const router = Router();
router.use(geminiKeyMiddleware);
router.post('/client-events', withRequestGeminiKey(receiveClientDiagnostics));
router.post("/validate-key", withRequestGeminiKey(async (req, res) => {
    try { return res.json(await geminiService.validateKey()); }
    catch (error) {
        const providerError = error.code === "GEMINI_REQUEST_FAILED";
        const status = providerError ? ([429,503].includes(error.status) ? error.status : 422) : 500;
        return res.status(status).json({ error: providerError ? error.message : "Key verification failed. Try again." });
    }
}));

const upload = multer({
    dest: os.tmpdir(),
    limits: {
        fieldSize: 1024 * 1024
    }
});

/**
 * STEP 1 ENDPOINT:
 * POST /api/searchfix/analyze-comments
 * Receives order comments from Chrome Extension (JSON body).
 * Returns issue classification, required document types, and status: "AWAITING_DOCUMENTS".
 */
router.post("/analyze-comments", withRequestGeminiKey(analyzeCommentsController));

/**
 * STEP 2 ENDPOINT:
 * POST /api/searchfix/analyze-documents
 * Receives uploaded PDF files downloaded by Chrome Extension (multipart/form-data).
 * Analyzes PDFs via Gemini Files API, extracts evidence, and returns ACCEPTED / DISPUTED / REVIEW_REQUIRED decision.
 */
router.post("/analyze-documents", upload.any(), withRequestGeminiKey(analyzeDocumentsController));

/**
 * UNIFIED ENDPOINT:
 * POST /api/searchfix/analyze
 * Supports both Step 1 (JSON) and Step 2 (multipart upload) dynamically.
 */
router.post("/analyze", upload.any(), withRequestGeminiKey(analyzeFullOrder));

export default router;

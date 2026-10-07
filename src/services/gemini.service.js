import fs from "fs";
import { validateSearchFixResponse } from "../utils/responseValidator.js";
import { getSystemPrompt, getUserPrompt } from "../prompts/searchfix.prompt.js";
import { currentGeminiClient } from "./geminiContext.service.js";
import { trace } from './trace.service.js';
import { modelsFor } from '../config/modelFallbacks.js';
import { geminiBudget, budgetError } from './geminiBudget.service.js';

// Use the configured chain order, including when an older .env names one model.
export function modelFor(stage = "comments") {
    return modelsFor(stage)[0];
}

export class GeminiService {
    constructor(client = null, { wait = ms => new Promise(resolve => setTimeout(resolve, ms)), budget = geminiBudget } = {}) {
        // Explicit dependency injection for tests; NEVER read GEMINI_API_KEY.
        this.defaultClient = client;
        this.wait = wait;
        this.budget = budget;
    }

    get ai() {
        const client = currentGeminiClient() || this.defaultClient;
        if (!client) throw new Error("Add a Gemini API key in the extension before analysis.");
        return client;
    }

    set ai(client) { this.defaultClient = client; }

    async validateKey() {
        const models = [];
        for (const stage of ["comments", "documents"]) {
            const { model } = await this.withModelFallback(stage, async model => {
                trace('key.model-check.start', { stage, model });
                const response = await this.guardedGenerate({
                    model, contents: "Reply with OK.", config: { maxOutputTokens: 32 }
                });
                trace('key.model-check.complete', { stage, model });
                return response;
            });
            models.push(model);
        }
        return { valid: true, credentialSource: "request", models };
    }

    async guardedGenerate(request) {
        if (!this.budget) return this.ai.models.generateContent(request); // Explicit test injection only.
        const { model, contents, config } = request;
        try {
            // Conservatively budget token-count calls as requests too. Check that both
            // count and generation can fit before spending the first request.
            this.budget.check(model, { requests: 2 });
            this.budget.reserve(model);
            // This SDK's Developer API does not support systemInstruction in countTokens.
            // Count it as an extra text part, along with every PDF/text evidence part.
            const countContents = [config?.systemInstruction || '', ...(Array.isArray(contents) ? contents : [contents])];
            const count = await this.ai.models.countTokens({ model, contents: countContents });
            if (!Number.isSafeInteger(count.totalTokens) || count.totalTokens < 0) {
                throw budgetError('Gemini could not confirm the input token count. Analysis was not sent.');
            }
            // Allow for role/format overhead in addition to the configured quota headroom.
            const tokens = Math.ceil(count.totalTokens * 1.1) + 256;
            const reservation = this.budget.reserve(model, { tokens });
            const response = await this.ai.models.generateContent(request);
            this.budget.reconcile(reservation, response.usageMetadata?.promptTokenCount);
            return response;
        } catch (error) {
            if (error.localQuota) trace('gemini.budget-skip', { model, code: 'LOCAL_QUOTA' });
            else if (error.status === 429) this.budget.cooldown(model);
            throw error;
        }
    }

    async withModelFallback(stage, call) {
        const models = modelsFor(stage);
        for (const [index, model] of models.entries()) {
            try {
                // Move promptly to the next candidate; retain bounded backoff on the last.
                const response = await this.retryWithBackoff(() => call(model), index === models.length - 1 ? 3 : 1);
                return { response, model };
            } catch (error) {
                if (!error.modelFallbackAllowed) throw error;
                if (index === models.length - 1) {
                    trace('gemini.chain-exhausted', { stage, model, httpStatus: error.status || 0 });
                    error.message = `No model in the ${stage} fallback chain succeeded. ${error.message}`;
                    throw error;
                }
                trace('gemini.model-fallback', { stage, model, httpStatus: error.status || 0 });
            }
        }
    }

    /**
     * Executes an API call function with automatic retry and exponential backoff.
     * Retries on 503 (UNAVAILABLE), 429 (RATE_LIMIT), or temporary network errors.
     */
    async retryWithBackoff(fn, maxRetries = 3) {
        let delay = 1000; // start with 1s delay
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                return await fn();
            } catch (error) {
                if (error.localQuota) throw error;
                trace('gemini.attempt.failed',{attempt,httpStatus:Number.isInteger(error.status)?error.status:0});
                const isRetryable = [429, 500, 502, 503, 504].includes(error.status) ||
                    (!error.status &&
                    (error.message && (
                        error.message.includes("503") ||
                        error.message.includes("high demand") ||
                        error.message.includes("UNAVAILABLE") ||
                        error.message.includes("RATE_LIMIT") ||
                        error.message.includes("ECONNRESET")
                    )));

                if (isRetryable && attempt < maxRetries) {
                    console.warn(`[GeminiService] API call failed (Attempt ${attempt}/${maxRetries}). Retrying in ${delay}ms...`);
                    await this.wait(delay);
                    delay *= 2; // exponential backoff
                } else {
                    // SDK errors can contain request headers/URLs. Never propagate credentials.
                    const messages = {
                        400: "Gemini rejected the key or request. Check your key and model access.",
                        401: "Gemini rejected this API key.",
                        403: "This API key does not have permission to use the requested Gemini model.",
                        404: "A configured Gemini model is unavailable to this API key.",
                        429: "Gemini model is experiencing high demand or rate limits (429). Please wait a moment and retry.",
                        503: "Gemini model is temporarily unavailable or experiencing high demand (503). Please retry shortly."
                    };
                    const safe = new Error(messages[error.status] || (error.message?.includes("high demand") ? "Gemini model is experiencing high demand. Please retry shortly." : "Gemini request failed. Check the API key, model access, quota, and connection."));
                    safe.code = "GEMINI_REQUEST_FAILED";
                    safe.modelFallbackAllowed = error.status === 404 || Boolean(isRetryable);
                    if (Number.isInteger(error.status)) safe.status = error.status;
                    throw safe;
                }
            }
        }
    }

    /**
     * Creates an inline base64 part for a local PDF file.
     * Fast, local, and requires zero external upload calls.
     */
    createInlinePdfPart(filePath) {
        const fileBuffer = fs.readFileSync(filePath);
        return {
            inlineData: {
                data: fileBuffer.toString("base64"),
                mimeType: "application/pdf"
            }
        };
    }

    /**
     * Executes standard generateContent call returning raw text or JSON.
     * Uses the ordered fallback chain for this analysis stage.
     */
    async generateJSON(systemInstruction, userPrompt, stage = "comments") {
        return this.generate(systemInstruction, userPrompt, stage);
    }

    async generate(systemInstruction, contents, stage) {
        const started=Date.now();
        const { response } = await this.withModelFallback(stage, async model => {
            trace('gemini.generate.start',{stage,model});
            const response = await this.guardedGenerate({
                model, contents,
                config: { systemInstruction, responseMimeType: "application/json" }
            });
            trace('gemini.generate.complete',{stage,model,durationMs:Date.now()-started});
            return response;
        });
        return response.text;
    }

    /**
     * Uploads a file via @google/genai Files API using ai.files.upload().
     */
    async uploadFile(filePath, mimeType = "application/pdf") {
        console.log(`[GeminiService] Uploading file to Gemini Files API: ${filePath}`);

        let uploadResult = await this.retryWithBackoff(async () => {
            return await this.ai.files.upload({
                file: filePath,
                config: {mimeType}
            });
        });

        try {
            for (let attempt = 0; uploadResult.state === "PROCESSING" && attempt < 30; attempt++) {
                await this.wait(1000);
                uploadResult = await this.ai.files.get({ name: uploadResult.name });
            }
            if (uploadResult.state === "PROCESSING" || uploadResult.state === "FAILED" || !uploadResult.uri) {
                throw new Error("Gemini could not prepare the uploaded document for analysis.");
            }
        } catch (error) {
            await this.deleteFile(uploadResult.name);
            throw error;
        }

        const uriOrName = uploadResult.uri || uploadResult.name || "uploaded";
        console.log(`[GeminiService] Upload complete. File identifier: ${uriOrName}`);
        return uploadResult;
    }

    /**
     * Deletes an uploaded file from Gemini Files API using ai.files.delete().
     */
    async deleteFile(fileName) {
        if (!fileName) return;
        try {
            console.log(`[GeminiService] Deleting file from Gemini Files API: ${fileName}`);
            await this.retryWithBackoff(async () => {
                await this.ai.files.delete({ name: fileName });
            });
        } catch (err) {
            console.warn(`[GeminiService] File deletion warning (${fileName}):`, err.message);
        }
    }

    /**
     * Executes generateContent with attached File handles or Inline Base64 PDF parts.
     */
    async generateContentWithFiles(systemInstruction, userPrompt, fileObjects = []) {
        return this.generate(systemInstruction, [...fileObjects, userPrompt], "documents");
    }

    /**
     * Legacy Phase 1 analysis method for backwards compatibility.
     */
    async analyzeComments(orderNumber, comments) {
        const modelName = modelFor("comments");
        console.log(`[SearchFix AI] Request started for Order: ${orderNumber} (${comments.length} comments) using model ${modelName}`);

        const systemInstruction = getSystemPrompt();
        const userPrompt = getUserPrompt(orderNumber, comments);

        try {
            const responseText = await this.generateJSON(systemInstruction, userPrompt);
            const validatedResult = validateSearchFixResponse(responseText, orderNumber);
            return validatedResult;
        } catch (error) {
            console.error(`[SearchFix AI] Error during Gemini analysis:`, error.message);
            throw error;
        }
    }
}

export const geminiService = new GeminiService();

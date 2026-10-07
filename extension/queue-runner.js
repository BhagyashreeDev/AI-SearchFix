import { requiredTypes, validateOrder, selectEvidenceAttachments } from "./core.js";
import { readOrderPage, readAttachment, readSupportingView, openSupportingLink, saveAndCloseTypingAssistant } from "./page-reader.js";

// Dependencies are injected so the full multi-order flow can be tested without
// sending order data to Gemini or interacting with production tasks.
export class QueueRunner {
  constructor({ tabs, inject, api, settings, onProgress = () => {}, onResult = () => {}, onOrderState = () => {}, onAnalysis = () => {}, onDocuments = () => {},
    wait = ms => new Promise(resolve => setTimeout(resolve, ms)), log = () => {} }) {
    Object.assign(this, { tabs, inject, api, settings, onProgress, onResult, onOrderState, onAnalysis, onDocuments, wait, log });
    this.stopped = false;
    this.ownedTabs = new Set();
    this.taTabs = new Set();
  }

  stop() { this.stopped = true; this.log('queue.stop.requested'); }

  async ready(tabId) {
    this.log('navigation.wait', {tabId});
    for (let attempt = 0; attempt < 40; attempt++) {
      const tab = await this.tabs.get(tabId);
      if (tab.status === "complete") { this.log('navigation.ready', {tabId}); return tab; }
      await this.wait(500);
    }
    throw new Error("The website did not finish loading.");
  }

  async openSource(orderTab, snapshot, kind) {
    this.log('source.resolve.start', {orderNumber:snapshot.orderNumber,kind});
    const before = new Set((await this.tabs.query({ url: "https://tv.datatracetitle.com/*" })).map(tab => tab.id));
    const opened = await this.inject(orderTab, openSupportingLink, [kind, snapshot.pageUrl]);
    this.log('source.resolve.complete', {kind});
    let tab;
    if (opened.url) {
      const target = new URL(opened.url);
      if (target.origin !== new URL(snapshot.pageUrl).origin) throw new Error("Source link belongs to another website.");
      tab = await this.tabs.create({ url: target.href, active: false });
      this.ownedTabs.add(tab.id);
      if(kind==='ta')this.taTabs.add(tab.id);
      await this.ready(tab.id);
    } else {
      // JavaScript popup links may open a new tab or reuse their named window.
      for (let attempt = 0; attempt < 40; attempt++) {
        const candidates = (await this.tabs.query({ url: "https://tv.datatracetitle.com/*" }))
          .filter(t => t.id !== orderTab && (!before.has(t.id) || t.openerTabId === orderTab))
          .sort((a, b) => Number(before.has(a.id)) - Number(before.has(b.id)));
        for (const candidate of candidates) {
          if (!before.has(candidate.id) && candidate.openerTabId === orderTab) {
            this.ownedTabs.add(candidate.id);
            if(kind==='ta' && /^\/TypingAssistant\.aspx$/i.test(new URL(candidate.url).pathname))this.taTabs.add(candidate.id);
          }
        }
        for (const candidate of candidates) {
          if (candidate.status !== "complete") continue;
          try {
            const view = await this.readSource(candidate.id, snapshot, kind);
            if(kind==='ta' && this.ownedTabs.has(candidate.id))this.taTabs.add(candidate.id);
            return { ...view, tabId: candidate.id };
          } catch { /* Popup may still be loading or belong to another order. */ }
        }
        await this.wait(500);
      }
      throw new Error("The source window could not be opened and matched to this order.");
    }
    // Attachment Manager fills its table after the page load event. TA can also
    // populate late. Retry empty content briefly, without clicking site controls.
    for (let attempt = 1; attempt <= 10; attempt++) {
      try {
        const view = await this.readSource(tab.id, snapshot, kind);
        if (kind === 'ta' || kind === 'tasks' || kind === 'exam' || view.attachments?.length || attempt === 10) {
          this.log('source.read.complete', {kind,count:view.attachments?.length,characters:view.text?.length,tasks:view.tasks?.length});
          return {...view,tabId:tab.id};
        }
      } catch (error) {
        if (attempt === 10 || !/empty|not an identifiable/i.test(error.message)) throw error;
      }
      this.log('source.content.wait', {kind,attempt});
      await this.wait(500);
    }
  }

  async readSource(tabId, snapshot, kind) {
    const id = [...new URL(snapshot.pageUrl).searchParams.entries()].find(([key]) => /^publicorderid$/i.test(key))?.[1] || "";
    return this.inject(tabId, readSupportingView, [snapshot.orderNumber, id, kind]);
  }

  async assertUnchanged(tabId, snapshot) {
    const fresh = await this.inject(tabId, readOrderPage, [this.settings]);
    if (fresh.pageUrl !== snapshot.pageUrl || fresh.orderNumber !== snapshot.orderNumber ||
      JSON.stringify(fresh.comments) !== JSON.stringify(snapshot.comments)) {
      throw new Error("The order or comments changed during processing. Read it again.");
    }
  }

  async releaseTA(view) {
    if(!this.ownedTabs.has(view.tabId))throw Error('Typing Assistant was already open. Use its Save and Close button manually.');
    this.taTabs.add(view.tabId);
    this.log('ta.save-close.start',{tabId:view.tabId});
    let submissionError;
    try { await this.inject(view.tabId,saveAndCloseTypingAssistant,[view.pageUrl,view.formState]); }
    catch(error){submissionError=error;}
    // Saving may close the window before executeScript can return its result.
    for(let attempt=0;attempt<40;attempt++){
      const open=(await this.tabs.query({})).some(tab=>tab.id===view.tabId);
      if(!open){this.ownedTabs.delete(view.tabId);this.taTabs.delete(view.tabId);this.log('ta.save-close.complete',{tabId:view.tabId});return;}
      if(submissionError && !/returned no page data|closed|removed|navigat|frame/i.test(submissionError.message))throw submissionError;
      await this.wait(250);
    }
    throw Error('Typing Assistant did not close after Save and Close. Its window was left open; check the website status and finish closing it manually.');
  }

  review(orderNumber, reason, previous = {}) {
    return { ...previous, orderNumber, status: "REVIEW_REQUIRED", overallDecision: "REVIEW_REQUIRED", reason };
  }

  async processOrder(tabId, task) {
    const target = new URL(task.url);
    if (target.origin !== "https://tv.datatracetitle.com" || !/\/OrderOverview\.aspx$/i.test(target.pathname) || target.username || target.password) {
      throw new Error("Only DataTrace Order Overview links can be processed.");
    }
    await this.tabs.update(tabId, { url: target.href });
    const loaded = await this.ready(tabId);
    if (loaded.url !== target.href) throw new Error("Order navigation was redirected; check your website session.");
    let snapshot;
    for (let attempt = 0; attempt < 10; attempt++) {
      snapshot = await this.inject(tabId, readOrderPage, [this.settings]);
      if (snapshot.orderNumber && snapshot.comments?.length) break;
      await this.wait(500);
    }
    const order = validateOrder(snapshot);
    this.log('order.read.complete', {orderNumber:order.orderNumber,count:order.comments.length});
    if (task.orderNumber && task.orderNumber !== order.orderNumber) throw new Error("The loaded order does not match the queue row.");
    
    this.onProgress(`Analyzing comments for ${order.orderNumber}…`);
    const step1 = await this.api("analyze-comments", { ...order, availableAttachments: snapshot.attachments || [] }, true);
    if (step1.orderNumber !== order.orderNumber) throw new Error("Comment result belongs to another order.");
    await this.assertUnchanged(tabId, snapshot);
    this.currentAnalysis = step1;
    this.onAnalysis(step1);
    if (step1.status !== "AWAITING_DOCUMENTS") return step1;

    const required = requiredTypes(step1);
    this.log('evidence.required', {required});
    const warnings = [];
    const selected = [];
    let taText = "";
    let attachmentsList = [];
    let attachmentsTabId = null;

    // Attachments are collected from the Attachments link when evidence analysis is needed
    if (required.some(type => type !== "TA") || required.includes("TA")) {
      this.onProgress(`Opening Attachments for ${order.orderNumber}…`);
      try {
        const view = await this.openSource(tabId, snapshot, "attachments");
        attachmentsList = view.attachments || [];
        attachmentsTabId = view.tabId;
        if (required.some(type => type !== "TA")) {
          selected.push(...selectEvidenceAttachments(attachmentsList, required, step1.issues).map(file => ({ ...file, tabId: view.tabId })));
          this.log('attachments.selected', { count: attachmentsList.length, selected: selected.map(file => file.type) });
        }
      } catch (error) {
        this.log('source.failed', { kind: 'attachments' });
        warnings.push(`Attachments: ${error.message}`);
      }
    }

    if (required.includes("TA")) {
      // Check if TA is present as .txt in attachments
      const taAttachment = attachmentsList.find(f => f.isTxt || (/\b(typing\s*assistant|ta)\b/i.test(f.name) && /\.txt$/i.test(f.name)));
      if (taAttachment && attachmentsTabId) {
        this.onProgress(`Reading Typing Assistant from attachments for ${order.orderNumber}…`);
        try {
          const fresh = await this.readSource(attachmentsTabId, snapshot, "attachments");
          const downloaded = await this.inject(attachmentsTabId, readAttachment, [taAttachment.url, fresh.pageUrl, {start:true,fileName:taAttachment.name}]);
          if (downloaded.base64) {
            taText = new TextDecoder().decode(Uint8Array.from(atob(downloaded.base64), c => c.charCodeAt(0)));
          }
        } catch (error) {
          this.log('ta.attachment.failed', { error: error.message });
        }
      }

      // If TA is not in attachments (or reading failed), open external Typing Assistant link
      if (!taText) {
        this.onProgress(`Reading Typing Assistant for ${order.orderNumber}…`);
        try {
          const view = await this.openSource(tabId, snapshot, "ta");
          taText = view.text || "";
          await this.releaseTA(view);
        } catch (error) {
          this.log('source.failed', { kind: 'ta' });
          warnings.push(`Typing Assistant: ${error.message}`);
        }
      }
    }

    // If TYPED_REPORT is required but not present in attachments, fetch from Typing Module (Exam)
    let typedReportText = "";
    if (required.includes("TYPED_REPORT")) {
      const typedAttachment = selected.find(file => file.type === "TYPED_REPORT");
      if (!typedAttachment) {
        this.onProgress(`Fetching Typed Report from Typing Module for ${order.orderNumber}…`);
        let tasksTabId = null;
        let examTabId = null;
        try {
          const tasksView = await this.openSource(tabId, snapshot, "tasks");
          tasksTabId = tasksView?.tabId;
          if (tasksView?.typingModuleUrl) {
            this.log('source.resolve.start', { orderNumber: snapshot.orderNumber, kind: 'exam' });
            const examTab = await this.tabs.create({ url: tasksView.typingModuleUrl, active: false });
            examTabId = examTab.id;
            this.ownedTabs.add(examTab.id);
            await this.ready(examTab.id);

            let examView = null;
            for (let attempt = 1; attempt <= 15; attempt++) {
              try {
                examView = await this.readSource(examTab.id, snapshot, "exam");
                if (examView?.previewUrl || (examView?.text && examView.text.length >= 20)) {
                  break;
                }
              } catch (error) {
                if (attempt === 15 || !/empty|loading|not an identifiable|cannot confirm/i.test(error.message)) {
                  throw error;
                }
              }
              await this.wait(500);
            }

            if (examView?.previewUrl) {
              this.log('exam.docx.selected', { name: examView.docxName, url: examView.previewUrl });
              selected.push({
                name: examView.docxName || `${order.orderNumber}_TypedReport.docx`,
                type: "TYPED_REPORT",
                url: examView.previewUrl,
                format: "docx",
                tabId: examTab.id,
                source: "exam"
              });
            } else if (examView?.text) {
              typedReportText = examView.text;
              this.log('source.read.complete', { kind: 'exam', characters: typedReportText.length });
            }
          }
        } catch (error) {
          this.log('source.failed', { kind: 'exam', error: error.message });
          warnings.push(`Typed Report (Exam): ${error.message}`);
        } finally {
          if (tasksTabId && this.ownedTabs.has(tasksTabId)) {
            try { await this.tabs.remove(tasksTabId); } catch {}
            this.ownedTabs.delete(tasksTabId);
          }
          if (examTabId && !selected.some(f => f.tabId === examTabId)) {
            try { await this.tabs.remove(examTabId); } catch {}
            this.ownedTabs.delete(examTabId);
          }
        }
      }
    }

    const documents = selected.map(file => ({ name: file.name, type: file.type, status: "FOUND" }));
    if (taText) documents.push({ name: "Typing Assistant text", type: "TA", status: "DOWNLOADED" });
    if (typedReportText) documents.push({ name: "Typed Report (Typing Module)", type: "TYPED_REPORT", status: "DOWNLOADED" });
    this.currentDocuments = documents; this.onDocuments(documents);
    const form = new FormData();
    form.append("orderData", JSON.stringify({ ...order, analysisId: step1.analysisId, taText, typedReportText }));
    let total = 0;
    for (const [index, file] of selected.entries()) {
      try {
        this.log('pdf.download.start', { fileType: file.type });
        let freshPageUrl = snapshot.pageUrl;
        if (file.source === "exam") {
          const fresh = await this.readSource(file.tabId, snapshot, "exam");
          if (!fresh.previewUrl && (!fresh.text || fresh.text.length < 20)) throw new Error("The Typing Module view changed.");
          freshPageUrl = fresh.pageUrl;
        } else {
          // Re-check source identity just before fetching evidence.
          const fresh = await this.readSource(file.tabId, snapshot, "attachments");
          if (!fresh.attachments.some(a => a.url === file.url)) throw new Error("The attachment listing changed.");
          freshPageUrl = fresh.pageUrl;
        }
        let downloaded = await this.inject(file.tabId, readAttachment, [file.url, freshPageUrl, { start: true, fileName: file.name }]);
        const chunks = []; let byteCount = 0; const transferId = downloaded.transferId;
        try {
          while (true) {
            const chunk = Uint8Array.from(atob(downloaded.base64), c => c.charCodeAt(0)); chunks.push(chunk); byteCount += chunk.length;
            if (!transferId || downloaded.done) break;
            if (downloaded.nextOffset !== byteCount) throw Error('Attachment transfer is incomplete.');
            downloaded = await this.inject(file.tabId, readAttachment, [file.url, freshPageUrl, { id: transferId, offset: downloaded.nextOffset }]);
          }
          if (downloaded.size != null && byteCount !== downloaded.size) throw Error('Attachment transfer is incomplete.');
        } finally { if (transferId) await this.inject(file.tabId, readAttachment, [file.url, freshPageUrl, { id: transferId, release: true }]).catch(() => {}); }
        const mimeType = downloaded.mimeType || "application/pdf";
        if (!["application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "text/plain"].includes(mimeType)) throw new Error("Unsupported attachment format.");
        total += byteCount;
        documents[index].status = "DOWNLOADED"; this.onDocuments(documents);
        this.log('pdf.download.complete', { fileType: file.type, bytes: byteCount });
        form.append(`file${index}`, new Blob(chunks, { type: mimeType }), file.name);
        form.append(`fileType_file${index}`, file.type);
      } catch (error) { documents[index].status = "FAILED"; this.onDocuments(documents); this.log('pdf.download.failed', { fileType: file.type, errorCode: error.code, httpStatus: error.httpStatus }); warnings.push(`${file.name}: ${error.message}`); }
    }
    await this.assertUnchanged(tabId, snapshot);
    this.onProgress(`Analyzing evidence for ${order.orderNumber}…`);
    this.log('evidence.submit', { bytes: total, characters: taText.length, missing: required.filter(type => type === 'TA' ? !taText : ![...form.entries()].some(([key, value]) => key.startsWith('fileType_') && value === type)) });
    // Empty evidence is deliberately submitted so missing files yield REVIEW_REQUIRED.
    for (const doc of documents) if (doc.status === "DOWNLOADED") doc.status = "ANALYZING";
    this.onDocuments(documents);
    const result = await this.api("analyze-documents", form);
    if (result.orderNumber !== order.orderNumber) throw new Error("Evidence result belongs to another order.");
    result.documents = documents.map(doc => (result.documents || []).find(item => item.name === doc.name && item.type === doc.type) || { ...doc, status: doc.status === "FAILED" ? "FAILED" : "UNVERIFIED" });
    await this.assertUnchanged(tabId, snapshot);
    if (warnings.length) return this.review(order.orderNumber, warnings.join("\n"), result);
    return result;
  }

  async run(tasks) {
    const results = [];
    const unique = [...new Map(tasks.map(task => [task.url, task])).values()];
    this.log('queue.start',{count:unique.length});
    let orderTab;
    try {
      orderTab = await this.tabs.create({ url: "about:blank", active: false });
      this.ownedTabs.add(orderTab.id);
      for (const task of unique) {
        if (this.stopped) break;
        this.onOrderState(task, "PROCESSING");
        this.log('order.start',{orderNumber:task.orderNumber});
        let result;
        this.currentAnalysis = {}; this.currentDocuments = [];
        try { result = await this.processOrder(orderTab.id, task); }
        catch (error) { this.log('order.failed',{orderNumber:task.orderNumber}); result = this.review(task.orderNumber || task.name, error.message, {...this.currentAnalysis, documents:this.currentDocuments.map(d=>({...d,status:d.status === "ANALYZING" ? "UNVERIFIED" : d.status}))}); }
        results.push(result);
        this.onOrderState(task, result.overallDecision || result.status);
        this.log('order.complete',{orderNumber:task.orderNumber,status:result.overallDecision || result.status});
        await this.onResult(result, results.length, unique.length, task);
        // Close only tabs this run created, leaving the user's existing tabs intact.
        for (const id of [...this.ownedTabs].filter(id => id !== orderTab.id && !this.taTabs.has(id))) {
          await this.tabs.remove(id).catch(() => {});
          this.ownedTabs.delete(id);
        }
      }
      return results;
    } finally {
      for (const id of this.ownedTabs)if(!this.taTabs.has(id))await this.tabs.remove(id).catch(() => {});
      this.ownedTabs.clear();
      this.log('queue.cleanup.complete',{count:results.length});
    }
  }
}

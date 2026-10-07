// Serialized by chrome.scripting.executeScript. Keep every helper inside this function.
// This reader never clicks controls, sets values, dispatches events, or submits forms.
export function readOrderPage(settings, captureErrors = false) {
  try {
  const clean = value => (value || "").replace(/\s+/g, " ").trim();
  const text = el => clean(el?.innerText || el?.textContent);
  const visible = el => !!el && !el.closest('[hidden], [aria-hidden="true"]') && el.getClientRects().length > 0;
  const query = (root, selector) => selector ? root.querySelector(selector) : null;
  const all = (root, selector) => selector ? [...root.querySelectorAll(selector)] : [];
  const value = (el, attr) => clean(el?.getAttribute(attr) || text(el));
  const safeLink = anchor => {
    try {
      const url = new URL(anchor.getAttribute("href"), location.href);
      return /^https?:$/.test(url.protocol) && url.origin === location.origin && !url.username && !url.password ? url.href : null;
    } catch { return null; }
  };
  const links = [...document.querySelectorAll("a[href]")].filter(visible);
  const tasks = [];
  const scanDiagnostics = {queueTables:0, searchFixRows:0, missingOverviewLinks:0};
  // Match the Task Name column, then use ONLY its row's Order Overview link.
  // Order-number links call IsTaskAvailable and may claim work; never follow them.
  for (const table of document.querySelectorAll("table")) {
    if (!visible(table)) continue;
    // ASP.NET grids can put TH or TD headers in TBODY. Ignore nested layout tables.
    const rows = [...table.querySelectorAll('tr')].filter(row=>row.closest('table')===table);
    const headerText = cell => text(cell).replace(/[▲▼△▽↑↓↕]/g,'').trim();
    const header = rows.find(row=>[...row.cells].some(cell=>/^task\s*name$/i.test(headerText(cell))) && [...row.cells].some(cell=>/^order\s*(?:number|no\.?|#)$/i.test(headerText(cell))));
    if (!header) continue;
    const taskHeaders = [...header.cells].map(headerText);
    const taskIndex = taskHeaders.findIndex(h=>/^task\s*name$/i.test(h));
    const orderIndex = taskHeaders.findIndex(h=>/^order\s*(?:number|no\.?|#)$/i.test(h));
    const stateIndex = taskHeaders.findIndex(h=>/^(st|state)$/i.test(h));
    const arrivalIndex = taskHeaders.findIndex(h=>/^arrival\s*time$/i.test(h));
    const countyIndex = taskHeaders.findIndex(h=>/^county$/i.test(h));
    scanDiagnostics.queueTables++;
    for (const row of rows) {
      const cells = row.cells;
      if (row===header || !visible(row) || !/\bsearch[\s-]*fix\b/i.test(text(cells[taskIndex]))) continue;
      scanDiagnostics.searchFixRows++;
      const overviewUrl = [...row.querySelectorAll('a[href]')].filter(a=>a.closest('tr')===row && visible(a)).map(safeLink).find(link=>{
        if (!link) return false;
        const url=new URL(link);
        return /\/OrderOverview\.aspx$/i.test(url.pathname) && [...url.searchParams].some(([key,id])=>key.toLowerCase()==='publicorderid' && id.trim());
      });
      const orderNumber=text(cells[orderIndex]);
      const state = stateIndex >= 0 ? text(cells[stateIndex]) : "";
      let arrivalTime = arrivalIndex >= 0 ? text(cells[arrivalIndex]) : "";
      if (!arrivalTime) {
        const slaCell = [...cells].find(c => /ArrivalTime:/i.test(c.innerHTML || ''));
        const match = slaCell ? (slaCell.innerHTML || '').match(/ArrivalTime:\s*([^"'>]+)/i) : null;
        if (match) arrivalTime = match[1].trim();
      }
      const county = countyIndex >= 0 ? text(cells[countyIndex]) : "";

      if (overviewUrl && orderNumber) {
        tasks.push({
          name:`${orderNumber} · ${text(cells[taskIndex])}`,
          orderNumber,
          url:overviewUrl,
          state: state || undefined,
          arrivalTime: arrivalTime || undefined,
          county: county || undefined
        });
      }
      else scanDiagnostics.missingOverviewLinks++;
    }
  }
  const queueLinks = links.filter(a => /^All Active and Available Tasks\*?$/i.test(text(a))).map(a => ({name:text(a),url:safeLink(a)})).filter(a=>a.url);
  const overviewLinks = links.filter(a => /^order\s*overview$/i.test(text(a))).map(a => ({ name: text(a), url: safeLink(a) })).filter(a => a.url);
  const findTable = header => [...document.querySelectorAll("table")].find(table => visible(table) && [...table.querySelectorAll("th")].some(th => header.test(text(th))));
  const commentRoot = query(document, settings.comments) || findTable(/^(comment|comments|comment text)$/i);
  const headers = commentRoot ? [...commentRoot.querySelectorAll("thead th, thead td")].map(text) : [];
  const cellFor = (row, pattern) => {
    const index = headers.findIndex(h => pattern.test(h));
    return index < 0 ? null : row.querySelectorAll("td")[index];
  };
  const normalizeDate = raw => {
    // ISO or unambiguous US month/day/year; reject two-digit years and other formats.
    const iso = raw.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
    if (iso) return iso[0];
    const us = raw.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
    return us ? `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}` : raw;
  };
  const normalizeTime = raw => {
    const match = raw.match(/\b(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?\b/i);
    if (!match) return raw;
    let hour = Number(match[1]);
    if (match[4]) hour = hour % 12 + (match[4].toUpperCase() === "PM" ? 12 : 0);
    return `${String(hour).padStart(2, "0")}:${match[2]}:${match[3] || "00"}`;
  };
  const dataTraceComments = commentRoot?.id.endsWith("_OrderCommentControl1_dgComments");
  const comments = commentRoot ? all(commentRoot, settings.commentRow).filter(visible).map(row => {
    if (dataTraceComments) {
      const cells = row.children;
      if (cells.length !== 4 || row.querySelector("select")) return {text:""};
      const stamp = text(cells[1]);
      return {author:text(cells[2]), date:normalizeDate(stamp), time:normalizeTime(stamp), text:text(cells[3])};
    }
    const dateElement = query(row, settings.date) || cellFor(row, /^date(?:\s*\/\s*time)?$/i);
    const dateText = value(dateElement, "data-date");
    return {
      author: value(query(row, settings.author) || cellFor(row, /^(author|user|created by)$/i), "data-author"),
      date: normalizeDate(dateText),
      time: normalizeTime(value(query(row, settings.time) || cellFor(row, /^time$/i), "data-time") || dateText),
      text: text(query(row, settings.text) || cellFor(row, /^(comment|comments|comment text)$/i))
    };
  }).filter(c => c.text) : [];
  const orderElement = query(document, settings.order);
  const orderNumber = value(orderElement, "data-order-number");
  const attachmentRoot = query(document, settings.attachments) || findTable(/^(attachment|attachments|file name|filename)$/i);
  const attachments = attachmentRoot ? [...attachmentRoot.querySelectorAll("a[href]")].filter(visible).map(a => ({
    name: clean(a.getAttribute("download") || text(a)), url: safeLink(a)
  })).filter(a => a.name && a.url) : [];
  return {
    pageUrl: location.href, title: document.title, orderNumber, comments,
    tasks: [...new Map(tasks.map(t => [t.url, t])).values()],
    scanDiagnostics,
    overviewLinks, queueLinks, attachments: [...new Map(attachments.map(a => [a.url, a])).values()],
    taStatus: text(document.querySelector('[id$="_liTypingAssistant"]')),
    typingAssistantText: text(query(document, settings.taRead)),
    warnings: ["Only currently rendered comments and attachments were read. Expand collapsed sections and load additional comment pages before analysis."]
  };
  } catch (error) {
    if (captureErrors) return {searchFixError:error.message};
    throw error;
  }
}

export async function readAttachment(url, expectedPageUrl, transfer = false, captureErrors = false) {
  if(typeof transfer === "boolean"){captureErrors=transfer;transfer=null;}
  const failure = (code, message, httpStatus) => Object.assign(new Error(message), {code, httpStatus});
  try {
  if (location.href !== expectedPageUrl) throw new Error("The order page changed. Read the order again.");
  const target = new URL(url);
  if (target.origin !== location.origin || !/^https?:$/.test(target.protocol) || target.username || target.password) throw new Error("Only attachments on this website can be read automatically. Use a local PDF for other hosts.");
  // The supplied browser URL establishes the PDF endpoint. The Manager's
  // AttachmentViewer URL is a navigation entry point, not the PDF stream.
  // Keep the verified file ID and use the existing tab's signed-in session.
  if (/^\/AttachmentViewer\.aspx$/i.test(target.pathname)) {
    const ids = [...target.searchParams].filter(([key])=>/^publicattachmentid$/i.test(key));
    if (ids.length !== 1 || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(ids[0][1])) {
      throw failure('ATTACHMENT_ID_INVALID', 'The attachment viewer does not identify one valid file.');
    }
    target.pathname = '/attachment.ashp';
    target.search = new URLSearchParams({publicAttachmentId:ids[0][1]}).toString();
    target.hash = '';
  }
  const encode = async blob => {
    const bytes=new Uint8Array(await blob.arrayBuffer());let binary='';
    for(let index=0;index<bytes.length;index+=32768)binary+=String.fromCharCode(...bytes.subarray(index,index+32768));
    return btoa(binary);
  };
  const readChunk=async(record,id,offset)=>{
    if(!Number.isInteger(offset)||offset<0||offset>=record.blob.size)throw Error('Invalid attachment transfer offset.');
    const next=Math.min(offset+1024*1024,record.blob.size);
    const base64=await encode(record.blob.slice(offset,next));
    if(next===record.blob.size)globalThis.__searchFixTransfers.delete(id);
    return {base64,transferId:id,nextOffset:next,done:next===record.blob.size,size:record.blob.size,mimeType:record.mimeType};
  };
  if(transfer?.id){
    const record=globalThis.__searchFixTransfers?.get(transfer.id);
    if(transfer.release){globalThis.__searchFixTransfers?.delete(transfer.id);return {released:true};}
    if(!record || record.url!==target.href || record.page!==expectedPageUrl)throw Error('Attachment transfer expired or belongs to another source.');
    return await readChunk(record,transfer.id,transfer.offset);
  }
  let response;
  // Word attachments may redirect to a download response instead of a viewer.
  // same-origin mode blocks cross-site redirects before fetching their content.
  const wordDownload = /\.docx?$/i.test(transfer?.fileName || target.pathname);
  try {
    response = await fetch(target.href, { method: "GET", credentials: "same-origin", mode: "same-origin", redirect: wordDownload ? "follow" : "error", signal: AbortSignal.timeout(300000) });
  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') throw failure('PDF_TIMEOUT', 'The PDF download timed out. Retry after checking the website connection.');
    throw failure('PDF_NETWORK_OR_REDIRECT', 'The PDF request failed or redirected. Confirm the file opens in this signed-in browser, then retry.');
  }
  if (response.url && new URL(response.url).origin !== location.origin) throw failure('PDF_NETWORK_OR_REDIRECT', 'The attachment redirected outside this website. Check the attachment link.');
  if (!response.ok) throw failure('PDF_HTTP_ERROR', `Attachment download failed (${response.status}). Check the website session and access to this file.`, response.status);
  const blob=await response.blob();
  const bytes=new Uint8Array(await blob.slice(0,8).arrayBuffer());
  const pdf = new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-";
  const doc = [208,207,17,224,161,177,26,225].every((value,index)=>bytes[index]===value);
  const docx = bytes[0]===80 && bytes[1]===75 && bytes[2]===3 && bytes[3]===4;
  const isTxt = /\.txt$/i.test(transfer?.fileName || target.pathname);
  if (!pdf && !doc && !docx && !isTxt) throw failure('PDF_CONTENT_INVALID', "The attachment response is not a PDF or Word document. It may be a sign-in or viewer page; check access in this browser.", response.status);
  const mimeType=pdf?'application/pdf':doc?'application/msword':docx?'application/vnd.openxmlformats-officedocument.wordprocessingml.document':'text/plain';
  if(transfer?.start){
    globalThis.__searchFixTransfers ||= new Map();
    const id=crypto.randomUUID(),record={blob,mimeType,url:target.href,page:expectedPageUrl};
    globalThis.__searchFixTransfers.set(id,record);
    setTimeout(()=>globalThis.__searchFixTransfers?.delete(id),300000);
    return await readChunk(record,id,0);
  }
  return {base64:await encode(blob),size:blob.size,mimeType};
  } catch (error) {
    if (captureErrors) return {searchFixError:error.message,errorCode:error.code || 'PDF_READ_FAILED',httpStatus:error.httpStatus};
    throw error;
  }
}

export function readSupportingView(orderNumber, publicOrderId, kind, captureErrors = false) {
  try {
  const text = (document.body?.innerText || "").trim();
  const title = (document.title || "").trim();
  const inputs = document.querySelectorAll ? [...document.querySelectorAll('input, select, textarea, [data-order], [id*="order"], [id*="Order"]')].map(el => el.value || el.innerText || '').join(" ") : "";
  const allPageText = (title + " " + text + " " + inputs).trim();

  const ids = [...new URL(location.href).searchParams.entries()].filter(([key]) => /^(publicorderid|orderid)$/i.test(key)).map(([,value]) => value);
  const managerId = location.pathname.match(/^\/Orders\/attachment\/Manager\/([^/]+)\/?$/i)?.[1];
  if (managerId) ids.push(decodeURIComponent(managerId));
  const urlMatches = publicOrderId && ids.some(v => v.toLowerCase() === publicOrderId.toLowerCase());

  const stripped = (orderNumber || "").replace(/^TPS[-_ ]*AD[-_ ]*/i, "").trim();
  const escapedFull = (orderNumber || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedStripped = stripped ? stripped.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : "";

  const numberMatches = (orderNumber && new RegExp(`(^|[^A-Za-z0-9-])${escapedFull}($|[^A-Za-z0-9-])`, "i").test(allPageText)) ||
                        (escapedStripped && new RegExp(`(^|[^A-Za-z0-9-])${escapedStripped}($|[^A-Za-z0-9-])`, "i").test(allPageText));

  if ((publicOrderId && ids.length && !urlMatches) || (!urlMatches && !numberMatches && kind !== "exam")) {
    throw new Error("Cannot confirm this popup belongs to the selected order. Paste the TA text or select downloaded PDFs manually after checking the order number.");
  }
  const visible = el => el?.getClientRects?.()?.length && !el.closest?.('[hidden], [aria-hidden="true"]');
  const headings = document.querySelectorAll ? [...document.querySelectorAll('h1, h2, [role="heading"]')].map(el => el.innerText) : [];
  const identity = [location.pathname, document.title, ...headings].join(" ");
  if (kind === "ta") {
    if (!/typing[\s_-]*assistant/i.test(identity) && !document.querySelector?.('[data-typing-assistant], #typing-assistant, [id$="_TypingAssistant"]')) {
      throw new Error("This window is not an identifiable Typing Assistant view.");
    }
    if (/\b(unlock|locked by|access denied|sign in|log in)\b/i.test(text)) throw new Error("Typing Assistant is locked or unavailable.");
    const values = [...new Set([...(document.querySelectorAll ? document.querySelectorAll('textarea') : [])].filter(visible).map(el => el.value.trim()).filter(Boolean))];
    const source = document.querySelector?.('[data-typing-assistant], #typing-assistant, [id$="_TypingAssistant"]');
    const reports = values.filter(value => /(?:vesting\s*:|--\s*(?:property info|internal comments|deeds)\s*--)/i.test(value));
    if (reports.length > 1 || (!reports.length && values.length > 1)) throw new Error("Multiple TA text boxes contain content; cannot identify one report reliably.");
    const content = (reports[0] || values[0] || source?.innerText || "").trim();
    if (!content || content.length > 120000) throw new Error("Typing Assistant is empty or exceeds 120,000 characters.");
    const formState=JSON.stringify([...(document.querySelectorAll ? document.querySelectorAll('input:not([type="hidden"]), textarea, select') : [])].map(el=>({id:el.id,name:el.name,value:el.value,checked:el.checked})));
    return { text: content, pageUrl:location.href, formState };
  }
  if (kind === "tasks") {
    if (!/tasks/i.test(identity) && !document.querySelector?.('#tblActiveTasks, table, .rgMasterTable, [id*="grdTasks"]')) {
      throw new Error("This window is not an identifiable Tasks view.");
    }
    const pageUrl = new URL(location.href);
    const pageWfiid = pageUrl.searchParams.get('wfiid') || '';
    const rows = document.querySelectorAll ? [...document.querySelectorAll('tr')] : [];
    let typingModuleUrl = null;
    const tasksFound = [];
    for (const row of rows) {
      const rowText = (row.innerText || "").replace(/\s+/g, " ").trim();
      if (!rowText) continue;
      if (/\b(?:typing[\s_-]*module|typing|exam)\b/i.test(rowText)) {
        const anchors = row.querySelectorAll ? [...row.querySelectorAll('a[href], [onclick]')] : [];
        for (const a of anchors) {
          const href = a.getAttribute('href') || '';
          const onclick = a.getAttribute('onclick') || '';
          if (/\/Exam/i.test(href) && !/^javascript:/i.test(href)) {
            typingModuleUrl = new URL(href, location.href).href;
            break;
          }
          const matchExam = (onclick + ' ' + href).match(/['"](\/?[^'"]*Exam[^'"]*)['"]/i);
          if (matchExam) {
            typingModuleUrl = new URL(matchExam[1], location.href).href;
            break;
          }
          const gotoMatch = (onclick + ' ' + href).match(/goto(?:Active)?Task\(\s*(['"])([^'"]+)\1\s*,\s*(['"])([^'"]+)\3(?:\s*,\s*(['"])([^'"]+)\5)?/i);
          if (gotoMatch) {
            const taskId = gotoMatch[2];
            const wfttid = gotoMatch[4];
            typingModuleUrl = new URL(`/Exam?id=${encodeURIComponent(taskId)}&examTaskName=Typing%20Module%20Task&wfttid=${encodeURIComponent(wfttid)}`, location.origin).href;
            break;
          }
        }
      }
      tasksFound.push(rowText);
    }
    if (!typingModuleUrl && pageWfiid) {
      typingModuleUrl = new URL(`/Exam?id=${encodeURIComponent(pageWfiid)}&examTaskName=Typing%20Module%20Task&wfttid=944`, location.origin).href;
    }
    return { tasks: tasksFound, typingModuleUrl, pageUrl: location.href };
  }
  if (kind === "exam") {
    if (!/exam|typing/i.test(identity) && !/\/Exam/i.test(location.pathname)) {
      throw new Error("This window is not an identifiable Typing Module (Exam) view.");
    }
    if (/The page you have requested cannot be viewed|This order could not be found|entitlements/i.test(text)) {
      throw new Error("Typing Module returned an entitlement or order not found error.");
    }

    let previewUrl = null;
    const previewBtn = (document.querySelectorAll ? [...document.querySelectorAll('button, input[type="button"], a')] : []).find(el => 
      /preview\s*output/i.test(el.innerText || el.value || el.getAttribute?.('title') || '') ||
      /launchPreviewDocument/i.test(el.getAttribute?.('onclick') || '')
    );

    if (previewBtn) {
      const onclick = previewBtn.getAttribute?.('onclick') || '';
      const match = onclick.match(/launchPreviewDocument\(\s*['"]([^'"]*)['"]\s*,\s*['"]([^'"]*)['"]\s*,\s*['"]([^'"]*)['"]\s*,\s*['"]([^'"]*)['"](?:\s*,\s*([^)]+))?\)/i);
      if (match) {
        const appPath = match[1] || '/';
        const pOrderId = match[2];
        const pwfiid = match[3];
        const token = match[4];

        let urlPattern = null;
        if (typeof window !== 'undefined' && typeof window.launchPreviewDocument === 'function') {
          const fnStr = window.launchPreviewDocument.toString();
          const pathMatch = fnStr.match(/['"`](\/?[^'"`]*(?:DocGen|Preview|Exam)[^'"`]*)['"`]/i);
          if (pathMatch) {
            urlPattern = pathMatch[1];
          }
        }

        if (urlPattern) {
          let resolvedPath = urlPattern;
          if (resolvedPath.includes('{') || resolvedPath.includes('%')) {
            resolvedPath = resolvedPath.replace(/\{publicorderid\}|\%publicorderid\%/gi, encodeURIComponent(pOrderId))
                                       .replace(/\{pwfiid\}|\%pwfiid\%/gi, encodeURIComponent(pwfiid))
                                       .replace(/\{token\}|\{key\}|\%token\%/gi, encodeURIComponent(token));
          } else if (!resolvedPath.includes('?')) {
            resolvedPath += `?publicOrderId=${encodeURIComponent(pOrderId)}&pwfiid=${encodeURIComponent(pwfiid)}&token=${encodeURIComponent(token)}`;
          }
          previewUrl = new URL(resolvedPath, location.origin).href;
        } else {
          previewUrl = new URL(`/DocGen/GeneratePreviewDocument?publicOrderId=${encodeURIComponent(pOrderId)}&pwfiid=${encodeURIComponent(pwfiid)}&token=${encodeURIComponent(token)}`, location.origin).href;
        }
      } else {
        const href = previewBtn.getAttribute?.('href');
        if (href && !/^javascript:/i.test(href)) {
          previewUrl = new URL(href, location.href).href;
        }
      }
    }

    const clone = document.body?.cloneNode ? document.body.cloneNode(true) : null;
    clone?.querySelectorAll?.('script, style, noscript, .modalPopup, [hidden], [aria-hidden="true"]')?.forEach?.(el => el.remove());

    const inputValues = [...(document.querySelectorAll ? document.querySelectorAll('textarea, input[type="text"], [contenteditable="true"]') : [])]
      .map(el => (el.value || el.innerText || "").trim())
      .filter(v => v.length > 20);

    let content = (clone?.innerText || "").replace(/\r\n/g, "\n").trim();
    if (inputValues.length > 0 && inputValues.some(v => !content.includes(v.slice(0, 30)))) {
      content += "\n\n--- Form Inputs ---\n" + inputValues.join("\n\n");
    }

    if (!previewUrl && (!content || content.length < 20)) {
      throw new Error("Typing Module is loading or empty.");
    }
    if (content.length > 250000) {
      content = content.slice(0, 250000);
    }
    return {
      previewUrl,
      docxName: `${(orderNumber || 'DocGenOutput').replace(/[^\w.-]/g, '_')}_TypedReport.docx`,
      text: content,
      pageUrl: location.href
    };
  }
  if (!/attachment/i.test(identity) && !document.querySelector?.('[data-attachments], #attachments')) {
    throw new Error("This window is not an identifiable Attachments view.");
  }
  const anchors = document.querySelectorAll ? [...document.querySelectorAll('a[href]')] : [];
  const attachments = anchors.filter(visible).flatMap(a => {
    try {
      const name = a.getAttribute("download") || a.innerText.trim();
      const raw = a.getAttribute("href");
      let url;
      if (/^javascript:/i.test(raw || '')) {
        // TitleVision filename cells use void(0) with openAttachment(GUID).
        // Parse the observed navigation only: never click/run its handler,
        // including the cosmetic color assignment or any edit/deliver action.
        if (!managerId || !/^javascript:\s*void\(\s*0\s*\)\s*;?\s*$/i.test(raw) ||
            !a.closest('td.filenameCell') || !a.closest('#tblAttachments, #tblSharedAttachments')) return [];
        const handler = (a.getAttribute('onclick') || '').trim();
        const match = handler.match(/^openAttachment\(\s*(['"])([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})\1\s*\)\s*;?\s*(?:this\.style\.color\s*=\s*(['"])purple\3\s*;?)?\s*$/i);
        if (!match || a.closest('tbody')?.id.toLowerCase() !== match[2].toLowerCase() || !/\.(pdf|docx?|txt)$/i.test(name)) return [];
        url = new URL(`/AttachmentViewer.aspx?PublicAttachmentId=${encodeURIComponent(match[2])}`, location.origin);
      } else {
        url = new URL(raw, location.href);
      }
      if (url.origin !== location.origin || url.username || url.password || !/^https?:$/.test(url.protocol) || !/\.(pdf|docx?|txt)(?:$|[?\s])/i.test(name + " " + url.pathname)) return [];
      const isTxt = /\.txt$/i.test(name);
      
      const tbody = a.closest('tbody');
      const attType = tbody?.querySelector?.('td.attTypeCell')?.innerText?.trim() || null;
      let attachedBy = null;
      let attachedDate = null;
      let attachedTime = null;
      let timestamp = null;

      const lastRow = tbody?.querySelector?.('tr.lastrow i, tr.lastrow td');
      const footerText = lastRow?.innerText?.trim() || "";
      if (footerText) {
        const stampMatch = footerText.match(/(?:Attached|Modified)\s+by\s+(.+?)\s+on\s+(\d{1,2}\/\d{1,2}\/\d{4})\s*@\s*(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)/i);
        if (stampMatch) {
          attachedBy = stampMatch[1].trim();
          attachedDate = stampMatch[2].trim();
          attachedTime = stampMatch[3].trim();
          const parsed = Date.parse(`${attachedDate} ${attachedTime}`);
          if (!isNaN(parsed)) timestamp = parsed;
        }
      }

      return [{
        name: name || url.pathname.split("/").pop(),
        url: url.href,
        pageUrl: location.href,
        isTxt,
        docType: attType || undefined,
        attachedBy: attachedBy || undefined,
        attachedDate: attachedDate || undefined,
        attachedTime: attachedTime || undefined,
        timestamp: timestamp || undefined
      }];
    } catch {return [];}
  });
  return {attachments:[...new Map(attachments.map(file=>[file.url,file])).values()], pageUrl:location.href};
  } catch (error) {
    if (captureErrors) return {searchFixError: error.message};
    throw error;
  }
}

// Explicitly authorized TA release action; never edit any field before saving.
export function saveAndCloseTypingAssistant(expectedPageUrl, expectedFormState, captureErrors = false) {
  try {
    if(location.href!==expectedPageUrl || location.origin!=='https://tv.datatracetitle.com' || !/^\/TypingAssistant\.aspx$/i.test(location.pathname))throw Error('Typing Assistant page changed; use Save and Close manually.');
    const state=JSON.stringify([...document.querySelectorAll('input:not([type="hidden"]), textarea, select')].map(el=>({id:el.id,name:el.name,value:el.value,checked:el.checked})));
    if(!expectedFormState || state!==expectedFormState)throw Error('Typing Assistant fields changed after reading; use Save and Close manually.');
    const buttons=document.querySelectorAll('input#btnSaveAndClose[name="btnSaveAndClose"][type="submit"]');
    const button=buttons.length===1?buttons[0]:null;
    if(!button || button.value!=='Save and Close' || button.disabled || !button.getClientRects().length || button.closest('[hidden], [aria-hidden="true"]'))throw Error('Typing Assistant Save and Close is unavailable; close it manually using the website.');
    const form=button.form;
    const action=new URL(button.getAttribute('formaction') || form?.action || location.href,location.href);
    if(!form || action.origin!==location.origin || action.username || action.password)throw Error('Typing Assistant save form is not on the expected website.');
    button.click();
    return {submitted:true};
  }catch(error){if(captureErrors)return {searchFixError:error.message};throw error;}
}

// Only the site's source-navigation links may be opened. Never invoke task,
// save, upload, or unlock controls. Runs in the original order tab.
export function openSupportingLink(kind, expectedPageUrl, captureErrors = false) {
  try {
  if (location.href !== expectedPageUrl) throw new Error("The order page changed.");
  if (kind === "tasks") {
    const page = new URL(location.href);
    const ids = [...page.searchParams].filter(([key]) => /^publicorderid$/i.test(key));
    const pid = ids.length ? ids[0][1] : '';

    // Look for workflow instances in grdWorkflowInstances
    const rows = [...document.querySelectorAll('[id*="grdWorkflowInstances"] tr.rgRow, [id*="grdWorkflowInstances"] tr.rgAltRow, tr.rgRow, tr.rgAltRow')];
    let selectedWfiid = null;
    let fallbackWfiid = null;

    for (const row of rows) {
      const rowText = (row.innerText || "").replace(/\s+/g, " ").trim();
      const anchor = row.querySelector('a[href*="showUtilityControlsWFI"], a[onclick*="showUtilityControlsWFI"], a[id*="hypProduct"]');
      const handlerStr = (anchor?.getAttribute('href') || '') + ' ' + (anchor?.getAttribute('onclick') || '');
      const match = handlerStr.match(/showUtilityControlsWFI\(\s*['"]([a-f0-9-]{36})['"]\s*\)/i);
      const hdnWfiid = row.querySelector('input[id*="hdnPublicWorkflowInstanceId"], input[name*="hdnPublicWorkflowInstanceId"]')?.value?.trim();
      const wfiid = match?.[1] || (hdnWfiid && /^[a-f0-9-]{36}$/i.test(hdnWfiid) ? hdnWfiid : null);

      if (wfiid) {
        if (!fallbackWfiid) fallbackWfiid = wfiid;
        // Prioritize title search/typing products (e.g. Two Owner, Full Title, Current Owner, Refinance, etc.)
        // Ignore QC / Rejection / SearchFix workflows
        if (!/quality\s*control|qc\s*rejection|search\s*fix|cancellation|billing/i.test(rowText)) {
          selectedWfiid = wfiid;
          break;
        }
      }
    }

    if (!selectedWfiid) {
      const anyMatch = document.documentElement.innerHTML.match(/showUtilityControlsWFI\(\s*['"]([a-f0-9-]{36})['"]\s*\)/i);
      selectedWfiid = fallbackWfiid || anyMatch?.[1];
    }

    if (pid && selectedWfiid) {
      return {
        url: new URL(`/Tasks.aspx?PublicOrderId=${encodeURIComponent(pid)}&wfiid=${encodeURIComponent(selectedWfiid)}`, page.origin).href,
        resolution: "workflow-instance-tasks-route"
      };
    }
    if (pid) {
      return {
        url: new URL(`/Tasks.aspx?PublicOrderId=${encodeURIComponent(pid)}`, page.origin).href,
        resolution: "known-read-only-route"
      };
    }
    const taskLink = [...document.querySelectorAll('a[href], [onclick]')].find(a => 
      /showUtilityControls|Tasks\.aspx/i.test(a.getAttribute('onclick') || a.getAttribute('href') || '')
    );
    if (taskLink) {
      const match = (taskLink.getAttribute('onclick') || taskLink.getAttribute('href') || '').match(/Tasks\.aspx\?([^'"]+)/i);
      if (match) {
        return { url: new URL(`/Tasks.aspx?${match[1]}`, location.origin).href, resolution: "extracted-task-route" };
      }
    }
    throw new Error("Could not identify Tasks link for this order.");
  }
  const pattern = kind === "ta" ? /^(typing\s*assistant|ta)(?:\s*\([^)]*\))?$/i : /^attachments?(?:\s*\(\d+\))?$/i;
  const links = [...document.querySelectorAll('a[href]')].filter(a =>
    a.getClientRects().length && !a.closest('[hidden], [aria-hidden="true"]') &&
    pattern.test((a.innerText || a.getAttribute("title") || a.querySelector('img')?.alt || "").trim()));
  if (links.length !== 1) throw new Error(`Could not identify one ${kind === "ta" ? "Typing Assistant" : "Attachments"} link.`);
  const link = links[0];
  if (/unlock|locked|disabled/i.test(`${link.className} ${link.getAttribute("onclick") || ""} ${link.getAttribute("aria-disabled") === "true" ? "disabled" : ""}`)) throw new Error("Source link is locked or disabled.");
  const raw = link.getAttribute("href");
  if (raw && !raw.startsWith("#") && !/^javascript:/i.test(raw)) {
    const url = new URL(raw, location.href);
    if (url.origin !== location.origin || url.username || url.password) throw new Error("Source link points outside this website.");
    return { url: url.href };
  }
  // Do not execute website handlers: even a source-looking control may claim or
  // unlock an order. Only extract a literal window.open URL without running it.
  const script = (link.getAttribute("onclick") || raw || "").replace(/^javascript:/i, "").trim();
  // Known TitleVision navigation shown in the supplied production HTML.
  // Resolve its read-only URL directly; never execute the handler or postback.
  const known = kind === "ta"
    ? {id:"_lnkTypingAssistant", handler:/^return\s+showTypingAssistant\(\s*\)\s*;?$/}
    : {id:"_lnkAttachments", handler:/^return\s+showAttachmentsV2\(\s*\)\s*;?$/};
  if (link.id.endsWith(known.id) && known.handler.test(script) &&
      link.closest('[id$="_divOrderLinksDetails"]')) {
    const page = new URL(location.href);
    const ids = [...page.searchParams].filter(([key]) => /^publicorderid$/i.test(key));
    if (!/\/OrderOverview\.aspx$/i.test(page.pathname) || ids.length !== 1 ||
        !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(ids[0][1])) {
      throw new Error("Cannot identify a unique PublicOrderId for this source link.");
    }
    if (kind === "ta" && document.querySelector('[id$="_lblTALockedBy"]')?.textContent.trim()) {
      throw new Error("Typing Assistant is locked by another user.");
    }
    const path = kind === "ta" ? `/TypingAssistant.aspx?PublicOrderId=${encodeURIComponent(ids[0][1])}`
      : `/Orders/attachment/Manager/${encodeURIComponent(ids[0][1])}`;
    return {url:new URL(path, page.origin).href, resolution:"known-read-only-route"};
  }
  const literal = script.match(/^(?:return\s+)?window\.open\(\s*(['"])([^'"]+)\1(?:\s*,\s*(['"])[^'"]*\3){0,2}\s*\)\s*;?\s*(?:return\s+false\s*;?)?$/);
  if (literal) {
    const target = new URL(literal[2], location.href);
    if (target.origin === location.origin && /^https?:$/.test(target.protocol) && !target.username && !target.password) return { url: target.href };
  }
  throw new Error("Source navigation requires an unverified website action. Open the read-only source manually; automatic analysis requires review.");
  } catch (error) {
    if (captureErrors) return {searchFixError: error.message};
    throw error;
  }
}

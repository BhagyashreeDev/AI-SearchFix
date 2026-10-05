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
  // Match the Task Name column, then use ONLY its row's Order Overview link.
  // Order-number links call IsTaskAvailable and may claim work; never follow them.
  for (const table of document.querySelectorAll("table")) {
    const taskHeaders = [...table.querySelectorAll("thead th")].map(text);
    const taskIndex = taskHeaders.findIndex(h => /^task name$/i.test(h));
    const orderIndex = taskHeaders.findIndex(h => /^order number$/i.test(h));
    if (taskIndex < 0) continue;
    for (const row of table.querySelectorAll("tbody tr")) {
      const cells = row.children;
      if (!/search\s*fix/i.test(text(cells[taskIndex]))) continue;
      const overview = row.querySelector('a[href^="OrderOverview.aspx"], a[data-order-overview]');
      if (overview && safeLink(overview)) tasks.push({name: `${text(cells[orderIndex])} · ${text(cells[taskIndex])}`, orderNumber: text(cells[orderIndex]), url: safeLink(overview)});
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
  if (!pdf && !doc && !docx) throw failure('PDF_CONTENT_INVALID', "The attachment response is not a PDF or Word document. It may be a sign-in or viewer page; check access in this browser.", response.status);
  const mimeType=pdf?'application/pdf':doc?'application/msword':'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
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
  const text = document.body.innerText;
  const ids = [...new URL(location.href).searchParams.entries()].filter(([key]) => /^(publicorderid|orderid)$/i.test(key)).map(([,value]) => value);
  const managerId = location.pathname.match(/^\/Orders\/attachment\/Manager\/([^/]+)\/?$/i)?.[1];
  if (managerId) ids.push(decodeURIComponent(managerId));
  const urlMatches = publicOrderId && ids.some(v => v.toLowerCase() === publicOrderId.toLowerCase());
  const escaped = orderNumber.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const numberMatches = orderNumber && new RegExp(`(^|[^A-Za-z0-9-])${escaped}($|[^A-Za-z0-9-])`).test(text);
  if ((publicOrderId && ids.length && !urlMatches) || (!urlMatches && !numberMatches)) throw new Error("Cannot confirm this popup belongs to the selected order. Paste the TA text or select downloaded PDFs manually after checking the order number.");
  const visible = el => el.getClientRects().length && !el.closest('[hidden], [aria-hidden="true"]');
  const identity = [location.pathname, document.title,
    ...[...document.querySelectorAll('h1, h2, [role="heading"]')].map(el => el.innerText)].join(" ");
  if (kind === "ta") {
    if (!/typing[\s_-]*assistant/i.test(identity) && !document.querySelector('[data-typing-assistant], #typing-assistant, [id$="_TypingAssistant"]')) {
      throw new Error("This window is not an identifiable Typing Assistant view.");
    }
    if (/\b(unlock|locked by|access denied|sign in|log in)\b/i.test(text)) throw new Error("Typing Assistant is locked or unavailable.");
    const values = [...new Set([...document.querySelectorAll('textarea')].filter(visible).map(el => el.value.trim()).filter(Boolean))];
    const source = document.querySelector('[data-typing-assistant], #typing-assistant, [id$="_TypingAssistant"]');
    const reports = values.filter(value => /(?:vesting\s*:|--\s*(?:property info|internal comments|deeds)\s*--)/i.test(value));
    if (reports.length > 1 || (!reports.length && values.length > 1)) throw new Error("Multiple TA text boxes contain content; cannot identify one report reliably.");
    const content = (reports[0] || values[0] || source?.innerText || "").trim();
    if (!content || content.length > 120000) throw new Error("Typing Assistant is empty or exceeds 120,000 characters.");
    const formState=JSON.stringify([...document.querySelectorAll('input:not([type="hidden"]), textarea, select')].map(el=>({id:el.id,name:el.name,value:el.value,checked:el.checked})));
    return { text: content, pageUrl:location.href, formState };
  }
  if (!/attachment/i.test(identity) && !document.querySelector('[data-attachments], #attachments')) {
    throw new Error("This window is not an identifiable Attachments view.");
  }
  const attachments = [...document.querySelectorAll('a[href]')].filter(visible).flatMap(a => {
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
        if (!match || a.closest('tbody')?.id.toLowerCase() !== match[2].toLowerCase() || !/\.(pdf|docx?)$/i.test(name)) return [];
        url = new URL(`/AttachmentViewer.aspx?PublicAttachmentId=${encodeURIComponent(match[2])}`, location.origin);
      } else {
        url = new URL(raw, location.href);
      }
      if (url.origin !== location.origin || url.username || url.password || !/^https?:$/.test(url.protocol) || !/\.(pdf|docx?)(?:$|[?\s])/i.test(name + " " + url.pathname)) return [];
      return [{name:name || url.pathname.split("/").pop(),url:url.href,pageUrl:location.href}];
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

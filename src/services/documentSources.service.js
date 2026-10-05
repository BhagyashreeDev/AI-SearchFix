import fs from 'node:fs';
import {PDFDocument} from 'pdf-lib';
import WordExtractor from 'word-extractor';

// These are per-model-call batch targets, not upload/file-count restrictions.
export const PDF_BATCH_BYTES=8*1024*1024;
export const PDF_BATCH_PAGES=200;
const PROVIDER_FILE_BYTES=45*1024*1024; // Headroom beneath Gemini's documented 50 MB PDF limit.
export function attachmentFormat(file){
 const head=Buffer.alloc(8),fd=fs.openSync(file.path,'r');
 try{fs.readSync(fd,head,0,8,0);}finally{fs.closeSync(fd);}
 if(head.subarray(0,5).toString()==='%PDF-')return 'pdf';
 if(/\.doc$/i.test(file.fileName||file.originalname||'') && head.equals(Buffer.from([208,207,17,224,161,177,26,225])))return 'doc';
 if(/\.docx$/i.test(file.fileName||file.originalname||'') && head.readUInt32LE(0)===0x04034b50)return 'docx';
 throw Error('Only readable PDF, DOC and DOCX attachments are supported.');
}
export async function extractWordText(filePath){
 const document=await new WordExtractor().extract(filePath);
 const text=[['Body','getBody'],['Headers and footers','getHeaders'],['Footnotes','getFootnotes'],['Endnotes','getEndnotes'],['Text boxes','getTextboxes'],['Annotations','getAnnotations']]
  .map(([label,method])=>{const content=document[method]?.()?.trim();return content?`${label}:\n${content}`:'';}).filter(Boolean).join('\n\n');
 if(!text.trim())throw Error('The Word document has no extractable text. Supply a readable PDF for image-only content.');
 return text;
}
export async function* pdfChunks(bytes,{maxBytes=PDF_BATCH_BYTES,maxPages=PDF_BATCH_PAGES}={}){
 const source=await PDFDocument.load(bytes);
 const pageCount=source.getPageCount();
 if(!pageCount)throw Error('The PDF has no readable pages.');
 if(pageCount<=maxPages && bytes.length<=maxBytes){yield {bytes,pageOffset:0,pageCount};return;}
 async function* range(start,end){
  const document=await PDFDocument.create();
  const pages=await document.copyPages(source,Array.from({length:end-start},(_,i)=>start+i));
  pages.forEach(page=>document.addPage(page));
  const chunk=await document.save();
  if(chunk.length>maxBytes && end-start>1){const middle=start+Math.floor((end-start)/2);yield* range(start,middle);yield* range(middle,end);return;}
  if(chunk.length>PROVIDER_FILE_BYTES)throw Error('A single PDF page exceeds Gemini’s supported size. Provide a compressed readable copy.');
  yield {bytes:chunk,pageOffset:start,pageCount:end-start};
 }
 for(let start=0;start<pageCount;start+=maxPages)yield* range(start,Math.min(start+maxPages,pageCount));
}
export async function* sourceChunks(file){
 const text=file.inlineText || (file.format && file.format!=='pdf'?await extractWordText(file.path):'');
 if(text){
  // Every segment is analyzed; nothing is truncated to fit a request.
  for(let offset=0;offset<text.length;offset+=100000)yield {file,text:text.slice(offset,offset+100000),textOffset:offset,bytesLength:0,pageCount:0};
  return;
 }
 const bytes=await fs.promises.readFile(file.path);
 for await(const chunk of pdfChunks(bytes))yield {...chunk,file,bytesLength:chunk.bytes.length};
}

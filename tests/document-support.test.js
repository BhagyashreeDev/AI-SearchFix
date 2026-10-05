import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {PDFDocument} from 'pdf-lib';
import {selectEvidenceAttachments} from '../extension/core.js';
import {readAttachment} from '../extension/page-reader.js';
import {missingEvidenceTypes} from '../src/services/evidenceCoverage.service.js';
import {pdfChunks,extractWordText,attachmentFormat} from '../src/services/documentSources.service.js';
import {documentAnalysisService} from '../src/services/documentAnalysis.service.js';
import {geminiService,GeminiService} from '../src/services/gemini.service.js';
import {analyzeDocumentsController} from '../src/controllers/searchfix.controller.js';
import {createApp} from '../src/app.js';
import {testPdf} from './helpers/documents.js';
import {selection} from './helpers/selection.js';
const attachment=name=>({name,url:'https://tv.datatracetitle.com/'+encodeURIComponent(name)});
const response=()=>({status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}});
const order={orderNumber:'SYNTHETIC-BUNDLE',comments:[{author:'Outsource',date:'2026-10-02',time:'12:00',text:'Deed omitted'}]};

test('omitted TA is retried alone and TA quotes are not attributed to the adjacent DOCX',async()=>{
 const original=geminiService.generateContentWithFiles,calls=[];
 const ta='Names searched: Synthetic Current Name';
 const reportFinding={document:'Typed Report.docx',page:null,finding:'The report was read.',quotedText:'This is a test of reviewing'};
 try{
  geminiService.generateContentWithFiles=async(system,prompt,parts)=>{
   calls.push(parts);assert.match(prompt,/Source checklist/);
   if(calls.length===1)return {evidence:[reportFinding,{document:'Typed Report.docx',finding:'TA names were read.',quotedText:ta}]};
   assert.equal(parts.length,1);assert.match(parts[0].text,/Type: TA/);assert.ok(parts[0].text.includes(ta));
   assert.doesNotMatch(parts[0].text,/This is a test of reviewing/);
   return {evidence:[{document:'Typing Assistant text',page:null,finding:'TA names were checked.',quotedText:ta}]};
  };
  const result=await documentAnalysisService.analyzeDocumentsForIssue({issueType:'TYPING_ERROR',claim:'Check the name',requiredDocuments:['TYPED_REPORT','TA']},[
   {fileName:'Typed Report.docx',fileType:'TYPED_REPORT',format:'docx',path:path.resolve('tests/fixtures/word-basic.docx')},
   {fileName:'Typing Assistant text',fileType:'TA',inlineText:ta}
  ]);
  assert.equal(calls.length,2);
  assert.deepEqual(result.map(e=>e.document),['Typed Report.docx','Typing Assistant text']);
  assert.ok(!result.some(e=>e.field==='documentAnalysisStatus'));
 }finally{geminiService.generateContentWithFiles=original;}
});

test('TA retry is bounded and omission, wrong-source quotes or quota failure stay unverified',async()=>{
 const original=geminiService.generateContentWithFiles;
 try{
  for(const mode of ['omitted','wrong-quote','quota']){
   let calls=0;
   geminiService.generateContentWithFiles=async()=>{
    calls++;
    if(calls===2 && mode==='quota')throw Object.assign(Error('Quota unavailable'),{code:'QUOTA_EXHAUSTED'});
    return {evidence:mode==='wrong-quote'?[{document:'Typing Assistant text',finding:'Wrong source',quotedText:'Not in supplied TA'}]:[]};
   };
   const result=await documentAnalysisService.analyzeDocumentsForIssue({requiredDocuments:['TA']},[{fileName:'Typing Assistant text',fileType:'TA',inlineText:'Synthetic TA names'}]);
   assert.equal(calls,2);assert.equal(result.length,1);assert.equal(result[0].field,'documentAnalysisStatus');
  }
 }finally{geminiService.generateContentWithFiles=original;}
});

test('complete TA findings do not make an extra model request',async()=>{
 const original=geminiService.generateContentWithFiles;let calls=0;
 try{
  geminiService.generateContentWithFiles=async()=>{calls++;return {evidence:[{document:'Typing Assistant text',finding:'Names read',quotedText:'Synthetic TA'}]};};
  const result=await documentAnalysisService.analyzeDocumentsForIssue({requiredDocuments:['TA']},[{fileName:'Typing Assistant text',fileType:'TA',inlineText:'Synthetic TA'}]);
  assert.equal(calls,1);assert.equal(result[0].document,'Typing Assistant text');
 }finally{geminiService.generateContentWithFiles=original;}
});

test('Word download redirects use the signed-in same-origin session and preserve DOC/DOCX bytes',async()=>{
 const origin='https://tv.datatracetitle.com',page=origin+'/Orders/attachment/Manager/synthetic';
 const url=origin+'/attachment.ashp?publicAttachmentId=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
 for(const format of ['doc','docx']){
  const content=fs.readFileSync('tests/fixtures/word-basic.'+format);
  const reader=vm.runInNewContext(`(${readAttachment.toString()})`,{URL,URLSearchParams,location:{href:page,origin},fetch:async(target,options)=>{
   assert.equal(target,url);assert.equal(options.redirect,'follow');assert.equal(options.mode,'same-origin');assert.equal(options.credentials,'same-origin');assert.equal(options.method,'GET');
   const response=new Response(content,{headers:{'Content-Disposition':'attachment; filename="Typed Report.'+format+'"'}});
   Object.defineProperty(response,'url',{value:origin+'/download/typed-report.'+format});return response;
  },AbortSignal,TextDecoder,Uint8Array,btoa,crypto:{randomUUID:()=> 'word-transfer'},setTimeout:()=>{}});
  const result=await reader(url,page,{start:true,fileName:'123 Typed Report.'+format});
  assert.deepEqual(Buffer.from(result.base64,'base64'),content);assert.equal(result.done,true);
  assert.equal(result.mimeType,format==='doc'?'application/msword':'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
 }
});

test('Word redirect responses cannot supply login HTML or cross-site content as evidence',async()=>{
 const origin='https://tv.datatracetitle.com',page=origin+'/attachments',url=origin+'/attachment.ashp';
 for(const [finalUrl,body,code] of [[origin+'/login','<html>Sign in</html>','PDF_CONTENT_INVALID'],['https://elsewhere.test/file',Buffer.from([80,75,3,4]),'PDF_NETWORK_OR_REDIRECT']]){
  const reader=vm.runInNewContext(`(${readAttachment.toString()})`,{URL,location:{href:page,origin},fetch:async()=>{const response=new Response(body);Object.defineProperty(response,'url',{value:finalUrl});return response;},AbortSignal,TextDecoder,Uint8Array});
  const result=await reader(url,page,{fileName:'Typed Report.docx'},true);
  assert.equal(result.errorCode,code);
 }
});

test('uploaded large PDF parts wait for processing and clean up failed preparation',async()=>{
 let requested,reads=0,deleted=[];
 const files={upload:async input=>{requested=input;return {name:'files/synthetic',state:'PROCESSING'};},get:async()=>{reads++;return {name:'files/synthetic',state:'ACTIVE',uri:'synthetic://document'};},delete:async({name})=>deleted.push(name)};
 const service=new GeminiService({files},{wait:async()=>{}});
 assert.equal((await service.uploadFile('synthetic.pdf')).uri,'synthetic://document');
 assert.deepEqual(requested,{file:'synthetic.pdf',config:{mimeType:'application/pdf'}});
 assert.equal(reads,1);
 files.get=async()=>({name:'files/synthetic',state:'FAILED'});
 await assert.rejects(service.uploadFile('synthetic.pdf'),/could not prepare/);
 assert.deepEqual(deleted,['files/synthetic']);
});

test('missing components use packages or Property Reports; TA and Typed Report are never substituted',()=>{
 const files=['123_Search Package.pdf','123_Typed Report.docx','123_Typed Report.pdf','123_TypingAssistant.docx'].map(attachment);
 assert.deepEqual(selectEvidenceAttachments(files,['SEARCH_PACKAGE','INDEX','TA','TYPED_REPORT']).map(f=>f.name),['123_Search Package.pdf','123_Typed Report.pdf']);
 assert.deepEqual(selectEvidenceAttachments(['Property Report.doc','Pacer.docx'].map(attachment),['SEARCH_PACKAGE','INDEX','TA']).map(f=>f.type),['PROPERTY_REPORT']);
 assert.deepEqual(selectEvidenceAttachments([attachment('Search Package.pdf')],['TA','TYPED_REPORT']),[]);
 assert.deepEqual(selectEvidenceAttachments([attachment('Pacer.docx')],['PACER']).map(f=>f.name),['Pacer.docx']);
});

test('bundle coverage needs cited contents and cannot stand in for TA or Typed Report',()=>{
 const files=[{fileName:'Property Report.pdf',fileType:'PROPERTY_REPORT'}];
 const evidence=[{document:'Property Report.pdf',finding:'Recorded deed and underlying search records.',quotedText:'Synthetic deed',page:2,documentTypes:['SEARCH_PACKAGE','TA','TYPED_REPORT']}];
 assert.deepEqual(missingEvidenceTypes(['SEARCH_PACKAGE','TA','TYPED_REPORT'],files,evidence),['TA','TYPED_REPORT']);
 assert.deepEqual(missingEvidenceTypes(['SEARCH_PACKAGE'],files,[{...evidence[0],quotedText:''}]),['SEARCH_PACKAGE']);
});

test('all PDF pages are batched and source page offsets survive beyond the first 200 pages',async()=>{
 const original=await testPdf(401),parts=[];
 for await(const part of pdfChunks(original))parts.push(part);
 assert.deepEqual(parts.map(p=>[p.pageOffset,p.pageCount]),[[0,200],[200,200],[400,1]]);
 for(const part of parts)assert.equal((await PDFDocument.load(part.bytes)).getPageCount(),part.pageCount);
 const small=[];for await(const part of pdfChunks(await testPdf(5),{maxBytes:1,maxPages:200}))small.push(part);
 assert.deepEqual(small.map(p=>p.pageOffset),[0,1,2,3,4]);
});

test('DOC and DOCX readers preserve text and Unicode without requiring Microsoft Word',async()=>{
 const results=[];
 for(const format of ['doc','docx']){
  const file=path.resolve('tests/fixtures/word-basic.'+format);
  assert.equal(attachmentFormat({path:file,fileName:'source.'+format}),format);
  const text=await extractWordText(file);assert.match(text,/This text has been inserted/);assert.match(text,/😀 ∀/);results.push(text);
 }
 assert.equal(results[0],results[1]);
});

test('segmented browser transfer returns every byte without the former 20 MB cap',async()=>{
 const content=Buffer.concat([Buffer.from('%PDF-1.4\n'),Buffer.alloc(21*1024*1024,32)]);
 const url='https://tv.datatracetitle.com/large.pdf',page='https://tv.datatracetitle.com/attachments';
 let fetched=0;
 const reader=vm.runInNewContext(`(${readAttachment.toString()})`,{URL,URLSearchParams,location:{href:page,origin:new URL(page).origin},fetch:async()=>{fetched++;return new Response(content);},AbortSignal,TextDecoder,Uint8Array,btoa,crypto:{randomUUID:()=> 'transfer'},setTimeout:()=>{}});
 let part=await reader(url,page,{start:true}),received=[];
 while(true){received.push(Buffer.from(part.base64,'base64'));assert.ok(part.base64.length<1500000);if(part.done)break;part=await reader(url,page,{id:part.transferId,offset:part.nextOffset});}
 assert.equal(fetched,1);assert.deepEqual(Buffer.concat(received),content);
 await assert.rejects(reader(url,page,{id:part.transferId,offset:0}),/expired/);
});

test('PDF evidence cites original pages after splitting, and unreadable sources remain reviewable',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'sf-chunks-')),file=path.join(directory,'package.pdf');
 const original=geminiService.generateContentWithFiles;
 try{
  fs.writeFileSync(file,await testPdf(201));let calls=0;
  geminiService.generateContentWithFiles=async()=>{calls++;return {evidence:[{document:'Package.pdf',page:1,finding:'Synthetic deed',quotedText:'Synthetic deed',documentTypes:['SEARCH_PACKAGE']}]};};
  const result=await documentAnalysisService.analyzeDocumentsForIssue({issueType:'MISSING_DEED',claim:'Missing deed',requiredDocuments:['SEARCH_PACKAGE']},[{fileName:'Package.pdf',fileType:'SEARCH_PACKAGE',format:'pdf',path:file}]);
  assert.equal(calls,2);assert.deepEqual(result.map(e=>e.page),[1,201]);assert.ok(result.every(e=>e.documentTypes.includes('SEARCH_PACKAGE')));
  fs.writeFileSync(file,'%PDF-corrupt');const failed=await documentAnalysisService.analyzeDocumentsForIssue({requiredDocuments:['SEARCH_PACKAGE']},[{fileName:'Package.pdf',fileType:'SEARCH_PACKAGE',format:'pdf',path:file}]);
  assert.equal(failed[0].field,'documentAnalysisStatus');
 }finally{geminiService.generateContentWithFiles=original;fs.rmSync(directory,{recursive:true,force:true});}
});

test('Property Report contents satisfy a missing package/deed only with current evidence; report and TA stay separate',async()=>{
 const originalJSON=geminiService.generateJSON,originalFiles=geminiService.generateContentWithFiles;
 geminiService.generateJSON=async(_s,_p,stage)=>stage==='documents'?{decision:'ACCEPTED',reason:'Verified current evidence.',nextSteps:['Recheck the identified deed.']}:selection([{issueType:'MISSING_DEED',claim:'Deed omitted'}]);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sf-coverage-'));
 try{
  for(const covered of [true,false]){
   const file=path.join(dir,'property.pdf');fs.writeFileSync(file,await testPdf());
   geminiService.generateContentWithFiles=async()=>({evidence:[{document:'Property Report.pdf',page:1,finding:'Synthetic deed in underlying search records.',quotedText:'Synthetic deed',documentTypes:covered?['SEARCH_PACKAGE']:[]},{document:'Typed Report.docx',page:null,finding:'Typed source text.'},{document:'Typing Assistant text',page:null,finding:'TA source text.'}]});
   const typed=path.join(dir,'typed.docx');fs.copyFileSync('tests/fixtures/word-basic.docx',typed);
   const res=response();await analyzeDocumentsController({body:{...order,taText:'Synthetic TA',fileType_file0:'PROPERTY_REPORT',fileType_file1:'TYPED_REPORT'},files:[{fieldname:'file0',originalname:'Property Report.pdf',path:file},{fieldname:'file1',originalname:'Typed Report.docx',path:typed}]},res);
   assert.equal(res.statusCode,200);assert.equal(res.body.status,covered?'ACCEPTED':'REVIEW_REQUIRED');
   assert.deepEqual(res.body.documents.map(d=>d.type),['PROPERTY_REPORT','TYPED_REPORT','TA']);
   assert.equal(fs.existsSync(file),false);assert.equal(fs.existsSync(typed),false);
  }
 }finally{geminiService.generateJSON=originalJSON;geminiService.generateContentWithFiles=originalFiles;fs.rmSync(dir,{recursive:true,force:true});}
});

test('HTTP uploads accept more than six files and more than 40 MB combined, cleaning up afterward',async()=>{
 const originalJSON=geminiService.generateJSON;
 geminiService.generateJSON=async()=>selection([],{selectedRole:'INTERNAL',disposition:'IGNORED'});
 const server=createApp().listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 try{
  const form=new FormData();form.append('orderData',JSON.stringify(order));
  const large=Buffer.concat([await testPdf(),Buffer.alloc(21*1024*1024,32)]);
  for(let i=0;i<8;i++)form.append('file'+i,new Blob([i<2?large:await testPdf()],{type:'application/pdf'}),'sample'+i+'.pdf');
  const result=await fetch(`http://127.0.0.1:${server.address().port}/api/searchfix/analyze-documents`,{method:'POST',headers:{'X-SearchFix-Gemini-Key':'TEST_UPLOAD_KEY_12345678901234567890'},body:form});
  assert.equal(result.status,200);assert.equal((await result.json()).status,'IGNORED');
 }finally{geminiService.generateJSON=originalJSON;await new Promise(resolve=>server.close(resolve));}
});

test('analysis requests allow five minutes before timing out',async()=>{
 const {createApiClient}=await import('../extension/api-client.js');
 const {BACKEND_ORIGIN}=await import('../extension/deployment.js');
 const timeout=AbortSignal.timeout,observed=[];
 AbortSignal.timeout=ms=>{observed.push(ms);return new AbortController().signal;};
 try{
  const api=createApiClient({backend:()=>BACKEND_ORIGIN,getKey:()=> 'TEST_TIMEOUT_KEY_12345678901234567890',fetcher:async()=>new Response('{}',{headers:{'X-SearchFix-Key-Source':'request'}})});
  await api('analyze-documents',new FormData());assert.deepEqual(observed,[300000]);
 }finally{AbortSignal.timeout=timeout;}
});

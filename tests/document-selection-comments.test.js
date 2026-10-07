import test from 'node:test';
import assert from 'node:assert/strict';
import {DOCUMENT_TYPES,guessDocumentType,selectEvidenceAttachments,suggestedComment} from '../extension/core.js';
import {DOCUMENT_MAPPINGS} from '../src/config/documentMappings.js';
import {decisionEngine} from '../src/services/decision.service.js';
import {geminiService} from '../src/services/gemini.service.js';
import {Step2IssueDecisionSchema} from '../src/schemas/result.schema.js';
const files=names=>names.map(name=>({name,url:'https://tv.datatracetitle.com/'+encodeURIComponent(name)}));
const issue={issueType:'MISSING_DEED',requiredFiles:[{fileType:'SEARCH_PACKAGE'}]};

test('only supported attachment types are requested; old issue categories keep supported evidence',()=>{
 assert.equal(DOCUMENT_TYPES.length,20);
 for(const removed of ['MAILING_LIST','UPDATE_REPORT','SUNBIZ','ASSIGNMENT','COURT_SEARCH','PROBATE','SURVEY','TORRENS','VENDOR_INSTRUCTIONS'])assert.ok(!DOCUMENT_TYPES.includes(removed));
 assert.equal(guessDocumentType('123_VendorManagement.pdf'),'VENDOR_MANAGEMENT');
 for(const types of Object.values(DOCUMENT_MAPPINGS))assert.ok(types.every(type=>DOCUMENT_TYPES.includes(type)));
});

test('separate deeds, PACER and PATRIOT are selected before package fallback in any listing order',()=>{
 const names=['Search Package.pdf','123_Warranty Deed.pdf','123_Pacer.pdf','123_Patriot.pdf'];
 for(const list of [names,[...names].reverse()]){
  const result=selectEvidenceAttachments(files(list),['SEARCH_PACKAGE','PACER','PATRIOT'],[issue]);
  assert.deepEqual(result.map(f=>f.name).sort(),names.slice(1).sort());
  assert.equal(result.find(f=>f.name.includes('Deed')).type,'SEARCH_PACKAGE');
 }
 assert.deepEqual(selectEvidenceAttachments(files(names),['PACER']).map(f=>f.name),['123_Pacer.pdf']);
 assert.deepEqual(selectEvidenceAttachments(files(['Search Package.pdf']),['PACER','PATRIOT']).map(f=>f.name),['Search Package.pdf']);
 assert.deepEqual(selectEvidenceAttachments(files(['Property Report.pdf']),['SEARCH_PACKAGE'],[issue]).map(f=>f.name),['Property Report.pdf']);
 assert.deepEqual(selectEvidenceAttachments(files(['Deed of Trust.pdf','Search Package.pdf']),['SEARCH_PACKAGE'],[issue]).map(f=>f.name),['Search Package.pdf']);
});

test('a separate deed cannot hide a missing PACER or a package needed by another issue',()=>{
 const source=files(['Deed.pdf','Search Package.pdf']);
 assert.deepEqual(selectEvidenceAttachments(source,['SEARCH_PACKAGE','PACER'],[issue]).map(f=>f.name),['Deed.pdf','Search Package.pdf']);
 assert.deepEqual(selectEvidenceAttachments(source,['SEARCH_PACKAGE'],[issue,{issueType:'SEARCH_DEPTH',requiredFiles:[{fileType:'SEARCH_PACKAGE'}]}]).map(f=>f.name),['Deed.pdf','Search Package.pdf']);
 assert.deepEqual(selectEvidenceAttachments(source,['TA','TYPED_REPORT'],[]),[]);
});

test('suggestions are status-gated, preserve per-issue facts and flag completion drafts',()=>{
 for(const status of ['IGNORED','REVIEW_REQUIRED','AWAITING_DOCUMENTS'])assert.equal(suggestedComment({status,reason:'Evidence',issues:[{decision:'DISPUTED',commentSuggestion:'Already present.'}]}),null);
 const accepted=suggestedComment({status:'ACCEPTED',issues:[{decision:'ACCEPTED',commentSuggestion:'The missing name was added to the search.'},{decision:'DISPUTED',commentSuggestion:'The deed is present on page 4.'},{decision:'REVIEW_REQUIRED',reason:'Missing tax proof.'}]});
 assert.equal(accepted.needsCompletion,true);assert.equal(accepted.hasPendingReview,true);assert.doesNotMatch(accepted.text,/Missing tax/);
 assert.match(accepted.text,/page 4/);
 const disputed=suggestedComment({status:'DISPUTED',issues:[{decision:'DISPUTED',reason:'Disputed: PACER page 2 already includes the name.'}]});
 assert.equal(disputed.needsCompletion,false);assert.doesNotMatch(disputed.text,/\bdisputed\b/i);
 assert.equal(suggestedComment({status:'ACCEPTED',decisionBasis:'CLIENT_TASK',reason:'Request a rush ETA.'}).needsCompletion,false);
});

test('decision suggestion survives the response schema without an additional model call',async()=>{
 const original=geminiService.generateJSON;let calls=0;
 try{
  geminiService.generateJSON=async()=>{calls++;return {decision:'DISPUTED',reason:'The name is in PACER.',nextSteps:[],commentSuggestion:'PACER page 2 includes the requested name.'};};
  const result=await decisionEngine.evaluateIssueDecision({requiredDocuments:['PACER']},[{document:'Pacer.pdf',finding:'Name found.'}]);
  const parsed=Step2IssueDecisionSchema.parse({...result,issueType:'PACER_SEARCH_DISCREPANCY',clientClaim:'Missing name',requiredDocuments:['PACER'],evidence:[]});
  assert.equal(parsed.commentSuggestion,'PACER page 2 includes the requested name.');assert.equal(calls,1);
  geminiService.generateJSON=async()=>({decision:'REVIEW_REQUIRED',reason:'Unknown',commentSuggestion:'Invented note.'});
  assert.equal((await decisionEngine.evaluateIssueDecision({requiredDocuments:[]},[{finding:'Unknown'}])).commentSuggestion,'');
 }finally{geminiService.generateJSON=original;}
});

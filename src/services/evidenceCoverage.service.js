const separate = new Set(['TA','TYPED_REPORT']);
export const isBundle=file=>['SEARCH_PACKAGE','PROPERTY_REPORT'].includes(file.fileType);
export function relevantEvidenceFiles(issue,files){
 return files.filter(file=>issue.requiredDocuments.includes(file.fileType) || (isBundle(file) && issue.requiredDocuments.some(type=>!separate.has(type))));
}
export function missingEvidenceTypes(required,files,evidence,issue={}){
 const isVmClaim = required.includes('VENDOR_MANAGEMENT') && (
  issue.issueType === 'VENDOR_REQUIREMENT_DISCREPANCY' ||
  /\b(?:not attached|missed to attach|missing|required but not|please confirm|as per vm)\b/i.test(issue.claim || issue.clientClaim || '')
 );
 return required.filter(type=>{
  if(files.some(file=>file.fileType===type))return false;
  if(isVmClaim && type !== 'VENDOR_MANAGEMENT')return false;
  if(separate.has(type))return true;
  // A bundle filename alone never proves it contains a requested component.
  return !evidence.some(item=>item.documentTypes?.includes(type) && item.quotedText?.trim() && item.finding?.trim() && files.some(file=>file.fileName===item.document && isBundle(file)));
 });
}

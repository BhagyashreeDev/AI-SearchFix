import {PDFDocument,StandardFonts} from 'pdf-lib';
export async function testPdf(count=1){
 const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica);
 for(let i=0;i<count;i++){const page=pdf.addPage([300,300]);page.drawText(`Synthetic page ${i+1}`,{x:25,y:250,size:14,font});}
 return Buffer.from(await pdf.save());
}

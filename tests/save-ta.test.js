import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {saveAndCloseTypingAssistant} from '../extension/page-reader.js';

function fixture(){
 const url='https://tv.datatracetitle.com/TypingAssistant.aspx?PublicOrderId=synthetic';
 let clicks=0;
 const textarea={id:'ta',name:'ta',value:'Original TA text'};
 const button={id:'btnSaveAndClose',name:'btnSaveAndClose',value:'Save and Close',disabled:false,getClientRects:()=>[{}],closest:()=>null,form:{action:url},getAttribute:()=>null,click:()=>clicks++};
 const fields=[textarea,button];
 const state=JSON.stringify(fields.map(el=>({id:el.id,name:el.name,value:el.value,checked:el.checked})));
 const location=new URL(url);
 const save=vm.runInNewContext(`(${saveAndCloseTypingAssistant.toString()})`,{URL,location,document:{querySelectorAll:selector=>selector.startsWith('input#')?[button]:fields}});
 return {url,state,save,button,textarea,location,clicks:()=>clicks};
}
test('TA submits the exact Save and Close control once without changing the text',()=>{
 const f=fixture();assert.equal(f.save(f.url,f.state).submitted,true);
 assert.equal(f.clicks(),1);assert.equal(f.textarea.value,'Original TA text');
});
test('TA save refuses changed fields, changed pages and unavailable or external submit controls',()=>{
 for(const change of [f=>{f.textarea.value='User edit';},f=>{f.location.pathname='/OrderOverview.aspx';},f=>{f.button.disabled=true;},f=>{f.button.form.action='https://elsewhere.test/save';}]){
  const f=fixture();change(f);assert.ok(f.save(f.url,f.state,true).searchFixError);assert.equal(f.clicks(),0);
 }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {openSupportingLink,readSupportingView,readOrderPage,navigateQueuePage} from '../extension/page-reader.js';
import {createPageInjector} from '../extension/injection.js';
import {createActivityLog} from '../extension/activity-log.js';
import {guessDocumentType,DEFAULT_SETTINGS} from '../extension/core.js';

const id='11111111-2222-3333-4444-555555555555';
const origin='https://tv.datatracetitle.com';
test('serialized source reader resolves supplied postback wrappers without calling website code',()=>{
  for(const [kind,suffix,handler,path] of [
    ['attachments','Attachments','showAttachmentsV2',`/Orders/attachment/Manager/${id}`],
    ['ta','TypingAssistant','showTypingAssistant',`/TypingAssistant.aspx?PublicOrderId=${id}`]
  ]) {
    const href=`${origin}/OrderOverview.aspx?PublicOrderId=${id}`;
    const link={id:`test_lnk${suffix}`,className:'',innerText:kind==='ta'?'Typing Assistant':'Attachments',
      getClientRects:()=>[{}],closest:selector=>selector.includes('divOrderLinksDetails')?{}:null,
      getAttribute:name=>name==='onclick'?`return ${handler}();`:name==='href'?"javascript:__doPostBack('blocked','')":null};
    const context={URL,location:new URL(href),document:{querySelectorAll:()=>[link],querySelector:()=>null}};
    const reader=vm.runInNewContext(`(${openSupportingLink.toString()})`,context);
    assert.equal(reader(kind,href,true).url,origin+path);
    link.getAttribute=name=>name==='onclick'?'return claimOrUnlockTask();':null;
    assert.match(reader(kind,href,true).searchFixError,/unverified|locked/);
  }
});

test('manager path identity rejects a different order even when its body contains the expected number',()=>{
  const reader=vm.runInNewContext(`(${readSupportingView.toString()})`,{URL,
    location:new URL(`${origin}/Orders/attachment/Manager/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee`),
    document:{body:{innerText:'TPS-AD-TEST'}}});
  assert.match(reader('TPS-AD-TEST',id,'attachments',true).searchFixError,/Cannot confirm/);
});

test('injection preserves returned and browser errors instead of generic page-read failure',async()=>{
  const events=[];
  const inject=createPageInjector({executeScript:async options=>{
    assert.equal(options.args.at(-1),true);
    return [{frameId:0,result:{searchFixError:'Typing Assistant is locked by another user.'}}];
  }},(event)=>events.push(event));
  await assert.rejects(inject(7,openSupportingLink,['ta','test']),/locked by another user/);
  assert.deepEqual(events,['page.read.start','page.read.failed']);
  const empty=createPageInjector({executeScript:async()=>[{frameId:0}]});
  await assert.rejects(empty(7,openSupportingLink,[]),/returned no page data/);
  const rejected=createPageInjector({executeScript:async()=>[{frameId:0,error:{message:'Permission denied'}}]});
  await assert.rejects(rejected(7,openSupportingLink,[]),/Permission denied/);
});

test('activity logs keep metadata but exclude credentials, source text, URLs and error bodies',()=>{
  const activity=createActivityLog();
  activity.log('test',{step:'readSupportingView',tabId:4,apiKey:'SECRET_KEY',comment:'PRIVATE_COMMENT',taText:'PRIVATE_TA',url:'https://host/?token=SECRET',message:'SECRET_ERROR'});
  assert.match(activity.text(),/readSupportingView/);
  assert.doesNotMatch(activity.text(),/SECRET|PRIVATE/);
});

test('filenames visible in Attachment Manager recognize snapshot spelling variants',()=>{
  assert.equal(guessDocumentType('1280806404_PASanp Shot.pdf'),'PA');
  assert.equal(guessDocumentType('1280806404_Index Sanp Shot.pdf'),'INDEX');
});

test('serialized Manager reader resolves attachment IDs independently of row order and rejects unsafe or mismatched rows',()=>{
  const fileId='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const secondId='bbbbbbbb-cccc-dddd-eeee-ffffffffffff';
  const taId='cccccccc-dddd-eeee-ffff-111111111111';
  const anchor=(name,attachmentId,options={})=>({innerText:name,
    getClientRects:()=>options.hidden?[]:[{}],
    getAttribute:key=>key==='href'?'javascript:void(0);':key==='onclick'?(options.handler || `openAttachment('${attachmentId}');this.style.color='purple';`):null,
    closest:selector=>selector==='tbody'?{id:options.rowId || attachmentId}:selector==='td.filenameCell'||selector==='#tblAttachments, #tblSharedAttachments'?{}:null});
  const links=[anchor('101-10925203_Search Package.pdf',fileId),anchor('AnotherOrder_Pacer.pdf',secondId),
    anchor('Hidden.pdf',fileId,{hidden:true}),anchor('TypingAssistant.txt',taId),
    anchor('Wrong.pdf',fileId,{rowId:secondId}),anchor('Unsafe.pdf',fileId,{handler:`openAttachment('${fileId}');deleteAttachment(this);`})];
  const reader=vm.runInNewContext(`(${readSupportingView.toString()})`,{URL,
    location:new URL(`${origin}/Orders/attachment/Manager/${id}`),
    document:{title:'Attachment Manager',body:{innerText:'TPS-AD-TEST'},querySelector:()=>null,querySelectorAll:selector=>selector==='a[href]'?links:[]}});
  for(let order=0;order<links.length;order++) {
    const found=reader('TPS-AD-TEST',id,'attachments');
    assert.equal(found.attachments.length,3);
    assert.equal(found.attachments.find(file=>guessDocumentType(file.name)==='SEARCH_PACKAGE').url,`${origin}/AttachmentViewer.aspx?PublicAttachmentId=${fileId}`);
    assert.equal(found.attachments.find(file=>guessDocumentType(file.name)==='PACER').url,`${origin}/AttachmentViewer.aspx?PublicAttachmentId=${secondId}`);
    assert.equal(found.attachments.find(file=>guessDocumentType(file.name)==='TA').url,`${origin}/AttachmentViewer.aspx?PublicAttachmentId=${taId}`);
    links.push(links.shift());
  }
});

test('serialized Manager reader extracts docType and timestamp from TitleVision tbody structure', () => {
  const fileId = '5517bbea-c7cb-40aa-8bb3-2cdb967e40dc';
  const tbodyMock = {
    id: fileId,
    querySelector: selector => {
      if (selector === 'td.attTypeCell') return { innerText: 'ExaminerNotes' };
      if (selector === 'tr.lastrow i, tr.lastrow td') return { innerText: 'Attached by NaveenC_ADSSearchType on 10/5/2026 @ 01:38:08 AM' };
      return null;
    }
  };
  const link = {
    innerText: '101-10934404_Index.pdf',
    getClientRects: () => [{}],
    getAttribute: key => key === 'href' ? 'javascript:void(0);' : key === 'onclick' ? `openAttachment('${fileId}');this.style.color='purple';` : null,
    closest: selector => selector === 'tbody' ? tbodyMock : selector === 'td.filenameCell' || selector === '#tblAttachments, #tblSharedAttachments' ? {} : null
  };
  const reader = vm.runInNewContext(`(${readSupportingView.toString()})`, {
    URL,
    location: new URL(`${origin}/Orders/attachment/Manager/${id}`),
    document: {
      title: 'Attachment Manager',
      body: { innerText: 'TPS-AD-TEST' },
      querySelector: () => null,
      querySelectorAll: selector => selector === 'a[href]' ? [link] : []
    }
  });
  const result = reader('TPS-AD-TEST', id, 'attachments');
  assert.equal(result.attachments.length, 1);
  const file = result.attachments[0];
  assert.equal(file.name, '101-10934404_Index.pdf');
  assert.equal(file.docType, 'ExaminerNotes');
  assert.equal(file.attachedBy, 'NaveenC_ADSSearchType');
  assert.equal(file.attachedDate, '10/5/2026');
  assert.equal(file.attachedTime, '01:38:08 AM');
  assert.equal(file.timestamp, Date.parse('10/5/2026 01:38:08 AM'));
});

test('serialized Tasks reader resolves TypingModule URL and handles exam page extraction', () => {
  const tasksLink = {
    innerText: 'TypingModule',
    getAttribute: key => key === 'onclick' ? `gotoTask('${id}','944','12345','67890',true)` : null,
    querySelectorAll: () => []
  };
  const row = {
    innerText: 'TypingModule 10/6/2026 VadlaA 10/6/2026',
    querySelectorAll: selector => selector.includes('a[href], [onclick]') ? [tasksLink] : []
  };
  const tasksReader = vm.runInNewContext(`(${readSupportingView.toString()})`, {
    URL,
    location: new URL(`${origin}/Tasks.aspx?PublicOrderId=${id}`),
    document: {
      title: 'Tasks [TPS-AD-TEST]',
      body: { innerText: 'Tasks [TPS-AD-TEST]' },
      querySelector: selector => selector.includes('tblActiveTasks') ? {} : null,
      querySelectorAll: selector => selector === 'tr' ? [row] : []
    }
  });
  const tasksResult = tasksReader('TPS-AD-TEST', id, 'tasks');
  assert.equal(tasksResult.typingModuleUrl, `${origin}/Exam?id=${id}&examTaskName=Typing%20Module%20Task&wfttid=944`);

  const previewBtn = {
    innerText: 'Preview Output',
    getAttribute: key => key === 'onclick' ? `launchPreviewDocument('/','${id}','4edb5632-a213-4e7f-a518-eabc4cb705a6','token123',true)` : null
  };
  const examReader = vm.runInNewContext(`(${readSupportingView.toString()})`, {
    URL,
    location: new URL(`${origin}/Exam?id=${id}&examTaskName=Typing%20Module%20Task&wfttid=944`),
    document: {
      title: 'TitleVision - Exam',
      body: {
        innerText: 'Order Details: TPS-AD-TEST\nSUB-SCHA: Customer Information\nSUB-LEGAL: Lot 3 Block 2022 Charlotte FL\nChain of Title: Deed 1234',
        cloneNode: () => ({
          querySelectorAll: () => [],
          innerText: 'Order Details: TPS-AD-TEST\nSUB-SCHA: Customer Information\nSUB-LEGAL: Lot 3 Block 2022 Charlotte FL\nChain of Title: Deed 1234'
        })
      },
      querySelector: () => null,
      querySelectorAll: selector => selector.includes('button') ? [previewBtn] : []
    }
  });
  const examResult = examReader('TPS-AD-TEST', id, 'exam');
  assert.equal(examResult.previewUrl, `${origin}/DocGen/GeneratePreviewDocument?publicOrderId=${id}&pwfiid=4edb5632-a213-4e7f-a518-eabc4cb705a6&token=token123`);
  assert.equal(examResult.docxName, 'TPS-AD-TEST_TypedReport.docx');
  assert.match(examResult.text, /SUB-LEGAL: Lot 3 Block 2022 Charlotte FL/);
  assert.match(examResult.text, /Chain of Title: Deed 1234/);
});

test('openSupportingLink resolves wfiid for Tasks.aspx from primary title workflow instance (Two Owner/Full Title)', () => {
  const poid = '8a9bdd6f-f3f8-495d-923e-1bb212e254bf';
  const twoOwnerWfiid = '9c51ddc0-934a-4f2a-8b51-feed60b47783';
  const qcWfiid = '1ed128b4-dd2d-4646-8282-30bdd1ef8a65';

  const twoOwnerRow = {
    innerText: 'Two Owner 202610028100005-001 Auto_VendorRequests',
    innerHTML: `<a href="javascript:showUtilityControlsWFI('${twoOwnerWfiid}'); ">Two Owner</a>`,
    querySelector: selector => selector.includes('hypProduct') ? {
      getAttribute: key => key === 'href' ? `javascript:showUtilityControlsWFI('${twoOwnerWfiid}'); ` : null
    } : selector.includes('hdnPublicWorkflowInstanceId') ? { value: twoOwnerWfiid } : null
  };

  const qcRow = {
    innerText: 'Quality Control Rejection 202610028100005-002 NamaJ_FAI',
    innerHTML: `<a href="javascript:showUtilityControlsWFI('${qcWfiid}'); ">Quality Control Rejection</a>`,
    querySelector: selector => selector.includes('hypProduct') ? {
      getAttribute: key => key === 'href' ? `javascript:showUtilityControlsWFI('${qcWfiid}'); ` : null
    } : selector.includes('hdnPublicWorkflowInstanceId') ? { value: qcWfiid } : null
  };

  const href = `${origin}/OrderOverview.aspx?PublicOrderId=${poid}`;
  const context = {
    URL,
    location: new URL(href),
    document: {
      documentElement: { innerHTML: '' },
      querySelectorAll: selector => selector.includes('grdWorkflowInstances') ? [twoOwnerRow, qcRow] : []
    }
  };
  const reader = vm.runInNewContext(`(${openSupportingLink.toString()})`, context);
  const result = reader('tasks', href, true);
  assert.equal(result.url, `${origin}/Tasks.aspx?PublicOrderId=${poid}&wfiid=${twoOwnerWfiid}`);
});

test('readOrderPage extracts RadGrid pager metadata accurately', () => {
  const pagerMock = {
    innerText: '560 items in 2 pages',
    textContent: '560 items in 2 pages',
    getClientRects: () => [{}],
    closest: () => null,
    querySelector: selector => {
      if (selector.includes('rgCurrentPage')) return { innerText: '1', textContent: '1', getClientRects: () => [{}] };
      if (selector.includes('rgPageNext')) return { disabled: false, classList: { contains: () => false } };
      return null;
    },
    querySelectorAll: selector => {
      if (selector.includes('rgNumPart a')) return [
        { innerText: '1', textContent: '1', getClientRects: () => [{}] },
        { innerText: '2', textContent: '2', getClientRects: () => [{}] }
      ];
      return [];
    }
  };

  const context = {
    URL,
    location: new URL(`${origin}/Queues.aspx`),
    document: {
      title: 'Order Manager Queue - TitleVision',
      querySelector: selector => {
        if (selector.includes('rgPager') || selector.includes('rgPagerCell')) return pagerMock;
        return null;
      },
      querySelectorAll: selector => {
        if (selector === 'table') return [];
        if (selector === 'a[href]') return [];
        return [];
      }
    }
  };

  const reader = vm.runInNewContext(`(${readOrderPage.toString()})`, context);
  const result = reader(DEFAULT_SETTINGS, true);
  assert.ok(result.pager);
  assert.equal(result.pager.currentPage, 1);
  assert.equal(result.pager.totalPages, 2);
  assert.equal(result.pager.totalItems, 560);
  assert.equal(result.pager.hasNextPage, true);
});

test('navigateQueuePage triggers click on corresponding target page link or next button', () => {
  let clickedPage = null;
  const page2Link = {
    innerText: '2',
    textContent: '2',
    querySelector: () => null,
    click: () => { clickedPage = 2; }
  };
  const page1Link = {
    innerText: '1',
    textContent: '1',
    querySelector: () => null,
    click: () => { clickedPage = 1; }
  };

  const pagerMock = {
    querySelector: selector => {
      if (selector.includes('rgCurrentPage')) return { innerText: '1', textContent: '1' };
      return null;
    },
    querySelectorAll: selector => {
      if (selector.includes('rgNumPart a')) return [page1Link, page2Link];
      return [];
    }
  };

  const context = {
    URL,
    location: new URL(`${origin}/Queues.aspx`),
    document: {
      querySelector: selector => {
        if (selector.includes('rgPager') || selector.includes('rgPagerCell')) return pagerMock;
        return null;
      }
    }
  };

  const nav = vm.runInNewContext(`(${navigateQueuePage.toString()})`, context);
  const res = nav(2, true);
  assert.equal(res.navigating, true);
  assert.equal(res.targetPage, 2);
  assert.equal(clickedPage, 2);
});

test('readOrderPage assigns current page number to extracted queue tasks', () => {
  const pagerMock = {
    innerText: '560 items in 2 pages',
    textContent: '560 items in 2 pages',
    getClientRects: () => [{}],
    closest: () => null,
    querySelector: selector => selector.includes('rgCurrentPage') ? { innerText: '2', textContent: '2', getClientRects: () => [{}], closest: () => null } : null,
    querySelectorAll: () => []
  };

  const headerRow = {
    cells: [
      { innerText: 'Order Number', textContent: 'Order Number', getClientRects: () => [{}], closest: () => null },
      { innerText: 'Task Name', textContent: 'Task Name', getClientRects: () => [{}], closest: () => null }
    ],
    getClientRects: () => [{}],
    closest: () => null
  };

  const overviewAnchor = {
    getAttribute: key => key === 'href' ? '/OrderOverview.aspx?PublicOrderId=p2-order' : null,
    getClientRects: () => [{}],
    closest: selector => selector === 'tr' ? taskRow : null
  };

  const taskRow = {
    cells: [
      { innerText: 'TPS-AD-PAGE2', textContent: 'TPS-AD-PAGE2', getClientRects: () => [{}], closest: () => null },
      { innerText: 'SearchFix', textContent: 'SearchFix', getClientRects: () => [{}], closest: () => null }
    ],
    getClientRects: () => [{}],
    closest: () => null,
    querySelectorAll: selector => selector.includes('a[href]') ? [overviewAnchor] : []
  };

  const tableMock = {
    getClientRects: () => [{}],
    closest: () => null,
    querySelectorAll: selector => selector === 'tr' ? [headerRow, taskRow] : []
  };
  headerRow.closest = selector => selector === 'table' ? tableMock : null;
  taskRow.closest = selector => selector === 'table' ? tableMock : null;

  const context = {
    URL,
    location: new URL(`${origin}/Queues.aspx`),
    document: {
      title: 'Order Manager Queue - TitleVision',
      querySelector: selector => (selector.includes('rgPager') || selector.includes('rgPagerCell')) ? pagerMock : null,
      querySelectorAll: selector => selector === 'table' ? [tableMock] : selector === 'a[href]' ? [overviewAnchor] : []
    }
  };

  const reader = vm.runInNewContext(`(${readOrderPage.toString()})`, context);
  const result = reader(DEFAULT_SETTINGS, false);
  assert.equal(result.tasks.length, 1);
  assert.equal(result.tasks[0].orderNumber, 'TPS-AD-PAGE2');
  assert.equal(result.tasks[0].pageNumber, 2);
});





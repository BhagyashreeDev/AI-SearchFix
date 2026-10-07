import {readOrderPage} from '/extension/page-reader.js';
import {DEFAULT_SETTINGS} from '/extension/core.js';
document.getElementById('absolute').href=new URL('/OrderOverview.aspx?PublicOrderId=test-4',location.href).href;
const before=document.getElementById('fixture').innerHTML;
try {
 const result=readOrderPage(DEFAULT_SETTINGS);
 if(JSON.stringify(result.tasks.map(task=>task.orderNumber))!==JSON.stringify(['TEST-1','TEST-2','TEST-3','TEST-4','TEST-5']))throw Error('Expected exactly five safe visible orders: '+JSON.stringify(result.tasks));
 if(result.scanDiagnostics.queueTables!==3 || result.scanDiagnostics.searchFixRows!==6 || result.scanDiagnostics.missingOverviewLinks!==1)throw Error('Incorrect diagnostic counts');
 if(before!==document.getElementById('fixture').innerHTML)throw Error('Reader changed the page');
 document.getElementById('results').textContent='PASS: all five SearchFix orders found.\nPASS: TH/TD headers inside TBODY and THEAD.\nPASS: full, relative, root-relative and case-varied overview links.\nPASS: hidden, nested, non-SearchFix, foreign and task-claiming links excluded.\nPASS: no website controls clicked or changed.\n'+JSON.stringify(result.scanDiagnostics);
}catch(error){document.getElementById('results').textContent='FAIL: '+error.message;}

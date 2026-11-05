const assert = require('assert');
const fs = require('fs');

const app=fs.readFileSync('js/app.js','utf8');
const html=fs.readFileSync('index.html','utf8');
const css=fs.readFileSync('styles.css','utf8');

assert(html.includes('js/operation-locks.js'),'operation lock registry loads before the app');
assert(app.includes('runOperationLocked(submitOperationKey(e.target)'),'all supported form submissions use keyed mutual exclusion');
assert(app.includes('WRITE_ACTION_SELECTOR'),'direct write actions use the same keyed lock boundary');
assert(app.includes("'import:json'"),'JSON import is protected from duplicate execution');
assert(app.includes('state.noteSaving'),'existing Notes formal-save guard remains in place');
assert(app.includes('state.radarSearching'),'existing Radar exploration guard remains in place');
assert(app.includes("new URLSearchParams(location.search).get('saveTiming') === '1'"),'save timing logs are development opt-in only');

assert(app.includes('data-print-overtime'),'overtime analysis exposes a print/PDF action');
assert(app.includes('window.print()'),'PDF export uses the browser print dialog');
assert(app.includes('overtimePrintReportHtml(facts,analysis,statusRecords)'),'the print report follows the current unsaved trial data');
assert(app.includes("portal.id='overtime-print-portal'"),'printing uses a top-level report portal that is independent of app layout');
assert(app.includes("window.addEventListener('afterprint',cleanup"),'the temporary print portal is cleaned after printing');
assert(css.includes('@media print'),'A4 print styles are present');
assert(css.includes('size: A4 portrait'),'print output explicitly targets A4');
assert(css.includes('body.printing-overtime > *:not(#overtime-print-portal)'),'only the dedicated top-level report is printed');
assert(!app.match(/data-print-overtime[^\n]+storage\.put/),'printing does not persist an overtime record');
console.log('Print and save-lock contract tests passed');

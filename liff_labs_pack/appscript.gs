/**
 * appscript.gs
 * Backend for LIFF -> GitHub Pages -> GAS -> Google Sheet + Drive
 *
 * Required Script Properties:
 *   SPREADSHEET_ID, FOLDER_ID, ALLOWED_ORIGIN
 *
 * Deploy as Web app: Execute as: Me, Access: Anyone
 */

const PROP = PropertiesService.getScriptProperties();
const SPREADSHEET_ID = PROP.getProperty('SPREADSHEET_ID');
const FOLDER_ID = PROP.getProperty('FOLDER_ID');
const ALLOWED_ORIGIN = PROP.getProperty('ALLOWED_ORIGIN') || '*';

if(!SPREADSHEET_ID || !FOLDER_ID){
  Logger.log('Please set SPREADSHEET_ID and FOLDER_ID in Script Properties');
}

const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
const workSheet = ss.getSheetByName('ข้อมูลการทำงาน');
const employeeSheet = ss.getSheetByName('ข้อมูลพนักงาน');

const WORK_HEADERS = workSheet.getRange(1,1,1,workSheet.getLastColumn()).getValues()[0];
const EMP_HEADERS = employeeSheet.getRange(1,1,1,employeeSheet.getLastColumn()).getValues()[0];

// ====== doGet ======
function doGet(e) {{
  return ContentService
    .createTextOutput('Backend running')
    .setMimeType(ContentService.MimeType.TEXT)
    .setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN)
    .setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
    .setHeader('Access-Control-Allow-Headers', 'Content-Type');
}}

// ====== doPost ======
function doPost(e) {{
  try {{
    const body = JSON.parse(e.postData.contents || '{{}}');
    const action = body.action;
    const args = body.args || [];
    let res;

    switch (action) {{
      case 'getWorkStateForToday': res = getWorkStateForToday(args[0]); break;
      case 'registerEmployee': res = registerEmployee(args[0]); break;
      case 'saveStartWork': res = saveStartWork(args[0]); break;
      case 'saveEndWork': res = saveEndWork(args[0]); break;
      case 'getWorkHistory': res = getWorkHistory(args[0]); break;
      default: throw new Error('Invalid action: ' + action);
    }}

    return createJsonResponse({{ status: 'success', response: res }});

  }} catch (err) {{
    Logger.log('doPost error: ' + err.stack);
    return createJsonResponse({{ status: 'error', message: err.message || String(err) }});
  }}
}}

// ====== สำหรับ Preflight Request ======
function doOptions(e) {{
  return ContentService
    .createTextOutput('')
    .setMimeType(ContentService.MimeType.TEXT)
    .setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN)
    .setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
    .setHeader('Access-Control-Allow-Headers', 'Content-Type');
}}

// ====== Helper ======
function createJsonResponse(obj) {{
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON)
    .setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN)
    .setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
    .setHeader('Access-Control-Allow-Headers', 'Content-Type');
}}

/* ===== Helpers ===== */

function findEmployeeData(userId){{
  if(!userId) return null;
  const rows = employeeSheet.getDataRange().getValues();
  const idx = EMP_HEADERS.indexOf('userId');
  for(let i=1;i<rows.length;i++){{
    if(String(rows[i][idx]) === String(userId)){{
      const rec = {{}};
      EMP_HEADERS.forEach((h,j) => rec[h] = rows[i][j]);
      return rec;
    }}
  }}
  return null;
}}

function getWorkStateForToday(userId){{
  if(!userId) throw new Error('Missing userId');
  const emp = findEmployeeData(userId);
  if(!emp) return {{ status: 'NO_EMP' }};

  const rows = workSheet.getDataRange().getValues();
  const uidCol = WORK_HEADERS.indexOf('userId');
  const dateCol = WORK_HEADERS.indexOf('ข้อมูลงานวันที่');
  const today = new Date().toLocaleDateString('en-CA');

  for(let i=rows.length-1;i>0;i--){{
    const rUser = String(rows[i][uidCol] || '');
    const rDate = rows[i][dateCol] ? new Date(rows[i][dateCol]).toLocaleDateString('en-CA') : '';
    if(rUser === String(userId) && rDate === today){{
      const rec = {{}};
      WORK_HEADERS.forEach((h,j)=> rec[h] = rows[i][j]);
      const status = (!rec['เวลาเลิกงาน'] || rec['เวลาเลิกงาน']==='') ? 'STARTED_NOT_ENDED' : 'COMPLETED';
      return {{ status: status, employeeData: emp, workData: rec }};
    }}
  }}
  return {{ status: 'NOT_STARTED', employeeData: emp, workData: null }};
}}

/* Register employee with backend validation */
function registerEmployee(data){{
  if(!data || !data.userId) throw new Error('Missing data.userId');
  const exists = findEmployeeData(data.userId);
  if(exists) return {{ status:'exists', message:'พนักงานมีในระบบแล้ว' }};

  const newRow = EMP_HEADERS.map(h => data[h] !== undefined ? data[h] : '');
  employeeSheet.appendRow(newRow);
  return {{ status:'ok', message:'ลงทะเบียนเรียบร้อย' }};
}}

/* Save start work: validate payload, upload images (base64), append row */
function saveStartWork(payload){{
  try {{
    const required = ['userId','startTime','startMileage'];
    required.forEach(k => {{ if(!payload || payload[k] === undefined || payload[k] === '') throw new Error('Missing '+k); }});

    const emp = findEmployeeData(payload.userId);
    if(!emp) throw new Error('ไม่พบข้อมูลพนักงาน (กรุณาลงทะเบียนก่อน)');

    const sid = `SID-${{payload.userId}}-${{new Date().getTime()}}`;
    const mileUrl = uploadFileToDrive(payload.startMileagePhoto, `${{sid}}_start_mileage`);
    const empUrl = uploadFileToDrive(payload.startEmployeePhoto, `${{sid}}_start_employee`);

    const now = new Date();
    const row = WORK_HEADERS.map(h => {{
      const map = {{
        'userId': payload.userId,
        'ข้อมูลงานวันที่': now,
        'เวลาที่ระบบบันทึก': now,
        'ชื่อ - นามสกุล': emp['ชื่อ - นามสกุล'] || '',
        'ทะเบียนรถ': emp['ทะเบียนรถ'] || '',
        'เบอร์ติดต่อ': emp['เบอร์ติดต่อ'] || '',
        'สาขา': emp['สาขา'] || '',
        'เวลาเริ่มงาน': payload.startTime || '',
        'เลขไมล์เริ่มงาน': payload.startMileage || '',
        'รูปถ่ายเลขไมล์เข้างาน': mileUrl || '',
        'รูปถ่ายพนักงานเข้างงาน': empUrl || ''
      }};
      return map[h] !== undefined ? map[h] : '';
    }});

    workSheet.appendRow(row);
    return {{ status:'ok', message:'บันทึกเวลาเริ่มงานเรียบร้อย' }};
  }} catch(e){{
    Logger.log(e);
    return {{ status:'error', message:e.message }};
  }}
}}

/* Save end work: find today's row, validate, update fields + upload images */
function saveEndWork(payload){{
  try {{
    const required = ['userId','endTime','endMileage','trips','totalDeliveries','successfulDeliveries'];
    required.forEach(k => {{ if(!payload || payload[k] === undefined || payload[k] === '') throw new Error('Missing '+k); }});

    const state = getWorkStateForToday(payload.userId);
    if(state.status !== 'STARTED_NOT_ENDED') throw new Error('ไม่สามารถบันทึกเลิกงานได้ (ยังไม่ได้ลงเวลาเริ่ม หรือบันทึกแล้ว)');

    const workData = state.workData;
    const rowIndex = findRowIndex(payload.userId, workData['ข้อมูลงานวันที่']);
    if(!rowIndex) throw new Error('แถวข้อมูลไม่พบ');

    const startMileage = Number(workData['เลขไมล์เริ่มงาน'] || 0);
    if(Number(payload.endMileage) < startMileage) throw new Error('เลขไมล์เลิกงานต้องมากกว่าเลขไมล์เริ่มงาน');

    const unsuccessful = Number(payload.totalDeliveries) - Number(payload.successfulDeliveries);
    const hours = calculateHours(workData['เวลาเริ่มงาน'], payload.endTime);
    const totalKm = Number(payload.endMileage) - startMileage;

    const endMileUrl = uploadFileToDrive(payload.endMileagePhoto, `END_${{payload.userId}}_${{new Date().getTime()}}_mile`);
    const endEmpUrl = uploadFileToDrive(payload.endEmployeePhoto, `END_${{payload.userId}}_${{new Date().getTime()}}_emp`);

    const updates = {{
      'เวลาเลิกงาน': payload.endTime,
      'เลขไมล์เลิกงาน': payload.endMileage,
      'จำนวนรอบงานที่วิ่ง': payload.trips,
      'จำนวนจุดที่นำออกส่งทั้งหมด': payload.totalDeliveries,
      'จำนวนจุดที่ส่งสำเร็จ': payload.successfulDeliveries,
      'จำนวนจุดที่ส่งไม่สำเร็จ': unsuccessful,
      'จำนวนชั่วโมงการทำงาน': Number(hours).toFixed(2),
      'ระยะทางรวม': totalKm,
      'ระบุ/หมายเหตุ': payload.notes || '',
      'รูปถ่ายเลขไมล์เลิกงาน': endMileUrl || '',
      'รูปถ่ายพนักงานเลิกงาน': endEmpUrl || ''
    }};

    Object.keys(updates).forEach(h => {{
      const col = WORK_HEADERS.indexOf(h) + 1;
      if(col > 0) workSheet.getRange(rowIndex, col).setValue(updates[h]);
    }});

    return {{ status:'ok', message:'บันทึกเวลาเลิกงานเรียบร้อย' }};
  }} catch(e){{
    Logger.log(e);
    return {{ status:'error', message:e.message }};
  }}
}}

/* Return last 5 records for user */
function getWorkHistory(userId){{
  try {{
    const rows = workSheet.getDataRange().getValues();
    const uidCol = WORK_HEADERS.indexOf('userId');
    const out = [];
    for(let i=rows.length-1;i>0 && out.length<5;i--){{
      if(String(rows[i][uidCol]) === String(userId)){{
        const rec = {{}};
        WORK_HEADERS.forEach((h,j) => {{
          let v = rows[i][j];
          if(h === 'ข้อมูลงานวันที่' && v instanceof Date) v = Utilities.formatDate(new Date(v), Session.getScriptTimeZone(), 'dd/MM/yyyy');
          rec[h] = v;
        }});
        out.push(rec);
      }}
    }}
    return out;
  }} catch(e){{
    Logger.log(e);
    return [];
  }}
}}

function findRowIndex(userId, dateObj){{
  const rows = workSheet.getDataRange().getValues();
  const uidCol = WORK_HEADERS.indexOf('userId');
  const dateCol = WORK_HEADERS.indexOf('ข้อมูลงานวันที่');
  const target = new Date(dateObj).toLocaleDateString('en-CA');
  for(let i=rows.length-1;i>0;i--){{
    const rUser = String(rows[i][uidCol] || '');
    const rDate = rows[i][dateCol] ? new Date(rows[i][dateCol]).toLocaleDateString('en-CA') : '';
    if(rUser === String(userId) && rDate === target) return i+1;
  }}
  return null;
}}

/* Upload base64 image data (data:...;base64,...) and return file URL */
function uploadFileToDrive(base64Data, filename){{
  if(!base64Data) return '';
  try {{
    if(!base64Data.startsWith('data:')) return '';
    const contentType = base64Data.substring(5, base64Data.indexOf(';'));
    const bytes = Utilities.base64Decode(base64Data.split(',')[1]);
    const blob = Utilities.newBlob(bytes, contentType, filename + '.png');
    const folder = DriveApp.getFolderById(FOLDER_ID);
    const file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return file.getUrl();
  }} catch(e){{
    Logger.log('uploadFileToDrive error: ' + e);
    return '';
  }}
}}

function calculateHours(startTimeStr, endTimeStr){{
  try {{
    const day = new Date().toISOString().split('T')[0];
    const s = new Date(day + 'T' + startTimeStr);
    const e = new Date(day + 'T' + endTimeStr);
    if(e < s) e.setDate(e.getDate()+1);
    return (e - s) / (1000*60*60);
  }} catch(e){{
    return 0;
  }}
}}

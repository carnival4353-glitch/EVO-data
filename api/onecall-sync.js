/**
 * ============================================================
 *  api/onecall-sync.js — evo-data repo-ийн ROOT-д /api folder
 *  дотор байрлуулах Vercel Serverless Function
 * ============================================================
 *
 *  ЗОРИЛГО: PBXUC (pbxuc.unitel.mn) руу нэвтэрч, дуудлагын
 *  мэдээллийг татаж, цэвэр JSON болгож буцаана. Google Apps Script
 *  үүнийг дуудаад Sheets рүү бичнэ.
 *
 *  ЯАГААД ЭНД ХИЙХ ВЭ (Apps Script дотор биш):
 *  pbxuc.unitel.mn серверийн SSL certificate chain дутуу тул
 *  Google Apps Script-ийн UrlFetchApp "SSL Error" өгдөг. Node.js
 *  (Vercel)-ийн стандарт fetch сан үүнийг зөвшөөрдөг тул энд
 *  асуудалгүй ажиллана.
 *
 *  ⚠️ ЭНЭ REPO НЬ NEXT.JS БИШ (зөвхөн index.html) — тиймээс
 *  файлыг яг repo-ийн ROOT-д "api/onecall-sync.js" гэсэн замаар
 *  байрлуулна (pages/api биш, app/api ч биш). Vercel ямар ч
 *  framework-гүй repo дээр ч /api folder-ыг автоматаар
 *  Serverless Function болгож таньдаг.
 *
 *  ШААРДЛАГАТАЙ: repo-ийн ROOT-д package.json файл байх ёстой
 *  бөгөөд дотор нь "xlsx" dependency зарлагдсан байх ёстой
 *  (энэ талаар зэрэгцүүлж явуулсан зааварт байгаа).
 *
 *  VERCEL ENVIRONMENT VARIABLES (Project → Settings → Environment Variables):
 *    EVO_USERNAME   = 33184159_user
 *    EVO_PASSWORD   = (шинэ, сольсон нууц үг)
 *    SYNC_SECRET    = (өөрөө зохиосон урт санамсаргүй нууц үг,
 *                      энэ endpoint-ийг хамгаалахад хэрэглэнэ)
 * ============================================================
 */

const XLSX = require('xlsx');

const BASE_URL = 'https://pbxuc.unitel.mn';

async function loginToPbxuc(username, password) {
  const body = new URLSearchParams({
    'LoginForm[acc_type]': 'ADMIN_LOGIN',
    'LoginForm[username]': username,
    'LoginForm[password]': password,
    'LoginForm[reseller_id]': '0',
    'LoginForm[applyCaptcha]': '0'
  });

  const res = await fetch(`${BASE_URL}/index.php/site/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Referer': `${BASE_URL}/index.php/0/site/login`,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    },
    body: body.toString(),
    redirect: 'manual'
  });

  // Node 18+ fetch (Vercel-д стандарт) дээр getSetCookie() ашиглана
  let cookies = [];
  if (typeof res.headers.getSetCookie === 'function') {
    cookies = res.headers.getSetCookie();
  } else {
    const single = res.headers.get('set-cookie');
    if (single) cookies = [single];
  }

  if (!cookies.length) {
    // Диагностик: жинхэнэ статус болон хариултын эхний хэсгийг барьж авна
    let bodySnippet = '';
    try {
      bodySnippet = (await res.text()).substring(0, 300);
    } catch (e) {
      bodySnippet = '(body уншиж чадсангүй: ' + e.message + ')';
    }
    const debugInfo = {
      status: res.status,
      statusText: res.statusText,
      headers: Object.fromEntries(res.headers.entries()),
      bodySnippet
    };
    throw new Error('Нэвтрэлт амжилтгүй: session cookie ирсэнгүй. DEBUG: ' + JSON.stringify(debugInfo));
  }

  return cookies.map((c) => c.split(';')[0]).join('; ');
}

async function fetchExportAsJson(cookie, pageUrl, exportUrl) {
  const res = await fetch(exportUrl, {
    headers: {
      Cookie: cookie,
      Referer: pageUrl,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
  });

  if (!res.ok) {
    throw new Error(`Export HTTP ${res.status}: ${exportUrl}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const firstSheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[firstSheetName];
  return XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
}

// ============================================================
//  VERCEL SERVERLESS FUNCTION (api/onecall-sync.js)
// ============================================================
module.exports = async function handler(req, res) {
  const token = req.query.token || req.headers['x-sync-token'];
  if (!process.env.SYNC_SECRET || token !== process.env.SYNC_SECRET) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const username = process.env.EVO_USERNAME;
    const password = process.env.EVO_PASSWORD;
    if (!username || !password) {
      throw new Error('EVO_USERNAME / EVO_PASSWORD env variables тохируулаагүй байна');
    }

    const cookie = await loginToPbxuc(username, password);

    const callsPageUrl = `${BASE_URL}/index.php/0/tenant/callRecordBillingTenant/admin`;
    const callsExportUrl = `${callsPageUrl}?export=true&ajax_total=true`;
    const calls = await fetchExportAsJson(cookie, callsPageUrl, callsExportUrl);

    const missedPageUrl = `${BASE_URL}/index.php/0/reports/missCallNotificationReport/admin`;
    const missedExportUrl = `${missedPageUrl}?export=true&ajax_total=true`;
    let missed = [];
    try {
      missed = await fetchExportAsJson(cookie, missedPageUrl, missedExportUrl);
    } catch (e) {
      // Missed-call export URL баталгаажаагүй тул алдаа гарвал
      // бүх процессыг зогсоохгүй, зөвхөн хоосон массив буцаана
      missed = [];
    }

    res.status(200).json({ calls, missed, callsCount: calls.length, missedCount: missed.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
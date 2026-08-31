import express from 'express';
import OpenAI from 'openai';
import Holidays from 'date-holidays';
import * as cheerio from 'cheerio';

const app = express();
app.use(express.json());
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
const MODEL = process.env.OPENAI_MODEL || 'gpt-5.6-luna';
const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const hd = new Holidays('JP');

const PIA_URL = 'https://t.pia.jp/pia/search_all.do?cAsgnFlg=false&bAsgnFlg=false&rlsIn=0&rlsKnd=01&noConvert=true&perfIn=0&includeSaleEnd=false&mode=2&rg=05&dispMode=1&pf=01&responsive=true&lg=02&lg=06&page=1&rlsStatus=0102&searchMode=1';

function jstDateOnly(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Tokyo', year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(d);
  const obj = Object.fromEntries(parts.map(p => [p.type,p.value]));
  return `${obj.year}-${obj.month}-${obj.day}`;
}
function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00+09:00`);
  d.setDate(d.getDate()+n);
  return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo'}).format(d);
}
function isWeekendOrHoliday(iso) {
  const d = new Date(`${iso}T00:00:00+09:00`);
  const wd = d.getDay();
  return wd === 0 || wd === 6 || !!hd.isHoliday(d);
}
function upcomingGroups(fromIso=jstDateOnly()) {
  const days=[];
  for(let i=1;i<=120;i++) { const iso=addDays(fromIso,i); if(isWeekendOrHoliday(iso)) days.push(iso); }
  const clusters=[];
  for(const iso of days){
    const prev=clusters.at(-1)?.at(-1);
    const diff=prev ? (new Date(`${iso}T00:00:00+09:00`)-new Date(`${prev}T00:00:00+09:00`))/86400000 : 99;
    if(!prev || diff>1) clusters.push([iso]); else clusters.at(-1).push(iso);
  }
  return { next: clusters[0]||[], second: clusters[1]||[], later: clusters.slice(2).flat() };
}

function extractJson(text){
  const clean = text.trim().replace(/^```json\s*/i,'').replace(/```$/,'').trim();
  return JSON.parse(clean);
}
async function askJson(prompt){
  if(!openai) throw new Error('OPENAI_API_KEY が設定されていません');
  const response = await openai.responses.create({
    model: MODEL,
    tools: [{ type:'web_search' }],
    input: prompt
  });
  return extractJson(response.output_text);
}

async function fetchPiaText(){
  try{
    const r = await fetch(PIA_URL, { headers:{'user-agent':'Mozilla/5.0 (compatible; EventPWA/1.0)'} });
    if(!r.ok) return '';
    const html = await r.text();
    const $ = cheerio.load(html);
    $('script,style,noscript').remove();
    return $('body').text().replace(/\s+/g,' ').slice(0,28000);
  } catch { return ''; }
}

app.get('/api/meta', (req,res) => {
  const today = jstDateOnly();
  res.json({ today, groups: upcomingGroups(today), piaUrl: PIA_URL, model: MODEL });
});

app.get('/api/pia', async (req,res) => {
  try{
    const pageText = await fetchPiaText();
    const prompt = `あなたは北海道のお笑い有料公演チケット調査員です。\n次のチケットぴあ検索URLを最優先に調べ、現在発売中または発売予定のお笑い公演だけを抽出してください。\nURL: ${PIA_URL}\n${pageText ? `取得できたページ本文（補助資料）: ${pageText}` : 'ページ本文の直接取得に失敗したためWeb検索でURLと関連公演ページを確認してください。'}\n\n各公演について eventName, saleDate, price, venue, eventDate, ticketUrl を返してください。saleDateは先行/一般があれば両方、priceは確認できた範囲、ticketUrlは個別チケットページを優先。推測禁止。不明は「未確認」。重複除去。\n出力は説明なしのJSONのみ: {"tickets":[{"eventName":"","saleDate":"","price":"","venue":"","eventDate":"","ticketUrl":""}]}`;
    const data = await askJson(prompt);
    res.json(data);
  } catch(e){ res.status(500).json({error:e.message}); }
});

app.get('/api/events', async (req,res) => {
  try{
    const today = jstDateOnly();
    const groups = upcomingGroups(today);
    const allDates = [...groups.next, ...groups.second, ...groups.later.slice(0,30)];
    const prompt = `2026年の北海道イベントをWeb/SNSで調査し、次の日付のいずれかに実際に開催されるイベントだけを返してください: ${allDates.join(', ')}。\n対象エリア: 札幌市（中央区、北区、東区、白石区、厚別区、豊平区、清田区、南区、西区、手稲区）、小樽、江別、北広島、恵庭、石狩、当別、新篠津、余市、仁木、岩見沢、南幌、長沼、月形、千歳、苫小牧、白老、登別。\n対象ジャンル: お笑いライブ、祭り・夏祭り、フェス、野外イベント、野外パーティ、花火・花火大会、マルシェ、イルミネーション、プロジェクションマッピング、ライトアップ、大型イベント、野外フェス、音楽フェス、ステージ・ステージイベント。\n「盆踊り」「縁日」は、それだけのイベントなら除外。ただし祭り/フェスの一企画として含まれる場合はイベント本体を対象にしてよい。\n重要: 大型サイトだけでなく、町内会、自治会、公園、神社、商店街、駅前広場、区役所/まちづくりセンター、地域メディア、主催者Instagram等も検索し、小規模な祭りで花火またはステージ企画があるものを積極的に拾う。\n開催期間中に対象日を含むイベントも対象。開催日・料金・エリア・公式または最も信頼できるURLを確認し、推測禁止。\n各イベント: eventName,startDate,endDate,dateLabel,ticketSale,price,area,url,features。日付はYYYY-MM-DD。単日ならstart=end。\n出力はJSONのみ: {"events":[{"eventName":"","startDate":"","endDate":"","dateLabel":"","ticketSale":"","price":"","area":"","url":"","features":""}]}`;
    const data = await askJson(prompt);
    res.json({ ...data, groups });
  } catch(e){ res.status(500).json({error:e.message}); }
});

app.listen(PORT, '0.0.0.0', ()=>console.log(`Event PWA running on port ${PORT}`));

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

function jstDateOnly(d = new Date()) { const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d); const o=Object.fromEntries(parts.map(p=>[p.type,p.value])); return `${o.year}-${o.month}-${o.day}`; }
function addDays(iso,n){ const d=new Date(`${iso}T00:00:00+09:00`); d.setDate(d.getDate()+n); return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo'}).format(d); }
function isWeekendOrHoliday(iso){ const d=new Date(`${iso}T00:00:00+09:00`); return d.getDay()===0||d.getDay()===6||!!hd.isHoliday(d); }
function upcomingGroups(fromIso=jstDateOnly()){ const days=[]; for(let i=1;i<=120;i++){const iso=addDays(fromIso,i);if(isWeekendOrHoliday(iso))days.push(iso)} const clusters=[]; for(const iso of days){const prev=clusters.at(-1)?.at(-1);const diff=prev?(new Date(`${iso}T00:00:00+09:00`)-new Date(`${prev}T00:00:00+09:00`))/86400000:99;if(!prev||diff>1)clusters.push([iso]);else clusters.at(-1).push(iso)} return {next:clusters[0]||[],second:clusters[1]||[],later:clusters.slice(2).flat()}; }
function extractJson(text){return JSON.parse(text.trim().replace(/^```json\s*/i,'').replace(/```$/,'').trim())}
async function askJson(prompt){if(!openai)throw new Error('OPENAI_API_KEY が設定されていません');const r=await openai.responses.create({model:MODEL,tools:[{type:'web_search'}],input:prompt});return extractJson(r.output_text)}

async function verifyTickets(tickets){
 if(!Array.isArray(tickets)||!tickets.length)return [];
 const checked=await askJson(`次のチケット候補を1件ずつWeb検索で再確認してください。イベント名・開催日・会場とticketUrlが同一公演であることを確認し、違えば正しい個別ページへ修正、確認不能なら除外。発売日は先行・一般を可能な限り確認する。JSONのみ。候補:${JSON.stringify({tickets})}\n形式:{"tickets":[{"eventName":"","saleDate":"","price":"","venue":"","eventDate":"","ticketUrl":""}]}`);
 return Array.isArray(checked.tickets)?checked.tickets:[];
}

async function verifyEvents(events){
 if(!Array.isArray(events)||!events.length)return [];
 const checked=await askJson(`あなたは北海道イベント情報の最終検証担当です。候補を1件ずつWeb検索し、タイトル、2026年の開催日、開催地、URL、参加方法を確認してください。\n候補:${JSON.stringify({events})}\n\n必須ルール:\n1. URLは当該イベントそのものを扱う公式・主催者・自治体・観光協会・会場等のページを優先。別イベント、別年度、トップページ、無関係ページは禁止。正しいURLを確認できなければ除外。\n2. ticketSaleは空欄・「記載なし」・「未確認」にしない。イベントごとに「チケット」「前売」「整理券」「申込」「予約」「受付」「参加方法」「当日参加」等を追加検索する。\n3. 有料チケット制なら、先行/一般発売日または受付開始日を具体的に記載する。\n4. 無料イベントでチケット不要・申込不要・自由参加なら ticketSale は「チケット不要（自由参加）」とする。\n5. 無料でも整理券・事前申込・予約・抽選が必要なら、その配布開始日/受付期間を確認して具体的に記載する。日付が公式に未発表の場合のみ「受付開始日未発表」とする。\n6. 当日券のみなら「当日受付」、現地販売なら確認できた販売方法を記載する。\n7. 「チケット発売日」という項目名に引きずられず、チケットが存在しないイベントには発売日を捏造しない。\n8. priceも同様に必ず確認し、無料なら「無料」、有料なら金額、公式に未発表なら「料金未発表」とする。\n9. 同一イベント重複除去。推測禁止。\n\nJSONのみ:{"events":[{"eventName":"","startDate":"","endDate":"","dateLabel":"","ticketSale":"","price":"","area":"","url":"","features":""}]}`);
 return Array.isArray(checked.events)?checked.events:[];
}

async function fetchPiaText(){try{const r=await fetch(PIA_URL,{headers:{'user-agent':'Mozilla/5.0 (compatible; EventPWA/1.0)'}});if(!r.ok)return '';const html=await r.text();const $=cheerio.load(html);$('script,style,noscript').remove();return $('body').text().replace(/\s+/g,' ').slice(0,28000)}catch{return ''}}

app.get('/api/meta',(req,res)=>{const today=jstDateOnly();res.json({today,groups:upcomingGroups(today),piaUrl:PIA_URL,model:MODEL})});
app.get('/api/pia',async(req,res)=>{try{const pageText=await fetchPiaText();const data=await askJson(`北海道のお笑い有料公演を次のチケットぴあ検索URLから調査。${PIA_URL}\n${pageText?`補助本文:${pageText}`:'直接取得失敗。Web検索で確認。'}\n公演名・発売日・料金・会場・開催日・個別ticketUrlを確認。URLは必ず同じ公演。JSONのみ:{"tickets":[{"eventName":"","saleDate":"","price":"","venue":"","eventDate":"","ticketUrl":""}]}`);res.json({tickets:await verifyTickets(data.tickets||[])})}catch(e){res.status(500).json({error:e.message})}});
app.get('/api/events',async(req,res)=>{try{const today=jstDateOnly();const groups=upcomingGroups(today);const allDates=[...groups.next,...groups.second,...groups.later.slice(0,30)];const data=await askJson(`2026年北海道イベントをWeb/SNSで調査。対象日:${allDates.join(', ')}。対象:札幌10区、小樽、江別、北広島、恵庭、石狩、当別、新篠津、余市、仁木、岩見沢、南幌、長沼、月形、千歳、苫小牧、白老、登別。ジャンル:お笑い、祭り、フェス、野外イベント、花火、マルシェ、イルミネーション、プロジェクションマッピング、ライトアップ、大型イベント、音楽フェス、ステージイベント。盆踊り/縁日のみは除外。小規模地域イベントも検索。\n各イベントについて開催日、料金、参加方法、チケット/整理券/申込/予約の有無と開始日・受付期間、正しい公式URLを調べる。ticketSaleを「記載なし」にしてはいけない。無料でチケット・申込不要なら「チケット不要（自由参加）」、整理券/申込等が必要なら受付情報、有料なら発売情報、未発表なら「受付開始日未発表」とする。推測禁止。\nJSONのみ:{"events":[{"eventName":"","startDate":"","endDate":"","dateLabel":"","ticketSale":"","price":"","area":"","url":"","features":""}]}`);res.json({events:await verifyEvents(data.events||[]),groups})}catch(e){res.status(500).json({error:e.message})}});
app.listen(PORT,'0.0.0.0',()=>console.log(`Event PWA running on port ${PORT}`));

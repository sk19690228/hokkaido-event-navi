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

async function verifyTickets(tickets){if(!Array.isArray(tickets)||!tickets.length)return [];const checked=await askJson(`次のチケット候補を1件ずつWeb検索で再確認してください。イベント名・開催日・会場とticketUrlが同一公演であることを確認し、違えば正しい個別ページへ修正、確認不能なら除外。発売日は先行・一般を可能な限り確認する。JSONのみ。候補:${JSON.stringify({tickets})}\n形式:{"tickets":[{"eventName":"","saleDate":"","price":"","venue":"","eventDate":"","ticketUrl":""}]}`);return Array.isArray(checked.tickets)?checked.tickets:[];}

async function verifyEvents(events){
 if(!Array.isArray(events)||!events.length)return [];
 const checked=await askJson(`北海道イベントの最終検証。候補を1件ずつWeb/SNS検索し、タイトル、2026年開催日、開催地、URL、参加方法を確認。候補:${JSON.stringify({events})}\n必須: URLは当該イベントそのものの公式・主催者・自治体・店舗・施設・商店街・町内会等のページ/公式SNS投稿を優先し、別年度・別イベントは禁止。ticketSaleは空欄/記載なしにしない。有料は発売/受付情報、無料で申込不要なら「チケット不要（自由参加）」、整理券/申込必要なら受付情報。priceも無料/金額/料金未発表を明示。\n特に町内会・自治会・商店街・個人店・ショップ・カフェ・飲食店・古着店・レコード店・商業施設・神社・公園等の小規模イベントは、ライブ演奏、バンド、弾き語り、DJ、DJプレイ、音楽ステージ、ダンスステージ等が実際にあることを確認できれば規模に関係なく残す。公式Instagram等しか情報源がない小規模イベントも、イベント名/日付/場所が確認できれば採用する。推測禁止。\nJSONのみ:{"events":[{"eventName":"","startDate":"","endDate":"","dateLabel":"","ticketSale":"","price":"","area":"","url":"","features":""}]}`);return Array.isArray(checked.events)?checked.events:[];
}

async function fetchPiaText(){try{const r=await fetch(PIA_URL,{headers:{'user-agent':'Mozilla/5.0 (compatible; EventPWA/1.0)'}});if(!r.ok)return '';const html=await r.text();const $=cheerio.load(html);$('script,style,noscript').remove();return $('body').text().replace(/\s+/g,' ').slice(0,28000)}catch{return ''}}

app.get('/api/meta',(req,res)=>{const today=jstDateOnly();res.json({today,groups:upcomingGroups(today),piaUrl:PIA_URL,model:MODEL})});
app.get('/api/pia',async(req,res)=>{try{const pageText=await fetchPiaText();const data=await askJson(`北海道のお笑い有料公演を次のチケットぴあ検索URLから調査。${PIA_URL}\n${pageText?`補助本文:${pageText}`:'直接取得失敗。Web検索で確認。'}\n公演名・発売日・料金・会場・開催日・個別ticketUrlを確認。URLは必ず同じ公演。JSONのみ:{"tickets":[{"eventName":"","saleDate":"","price":"","venue":"","eventDate":"","ticketUrl":""}]}`);res.json({tickets:await verifyTickets(data.tickets||[])})}catch(e){res.status(500).json({error:e.message})}});
app.get('/api/events',async(req,res)=>{try{const today=jstDateOnly();const groups=upcomingGroups(today);const allDates=[...groups.next,...groups.second,...groups.later.slice(0,30)];const data=await askJson(`2026年北海道イベントをWeb/SNSで幅広く調査。対象日:${allDates.join(', ')}。対象:札幌10区、小樽、江別、北広島、恵庭、石狩、当別、新篠津、余市、仁木、岩見沢、南幌、長沼、月形、千歳、苫小牧、白老、登別。\n対象ジャンル:お笑い、祭り、フェス、野外イベント、花火、マルシェ、イルミネーション、プロジェクションマッピング、ライトアップ、大型イベント、音楽フェス、ライブステージ、音楽ステージ、DJイベント、DJプレイ、ダンス/パフォーマンスステージ。盆踊り/縁日のみは除外。\n最重要: 大規模イベントだけでなく、町内会・自治会・町内会連合会・地域のお祭り・商店街・個人ショップ・セレクトショップ・古着店・レコード店・カフェ・飲食店・バー・商業施設・ショッピングモール・神社・公園・地域センター・まちづくりセンター等の小さな催しを積極的に探す。ライブ演奏、バンド、弾き語り、DJ、音楽ステージ等が1つでもあるイベントは規模に関係なく対象。店舗公式サイトだけでなく公式Instagram/Facebook/X、主催者SNS、町内会/地域団体SNS、地域メディアも検索する。\n検索語も「町内会 夏祭り ライブ」「地域祭り ステージ」「商店街 ライブ」「ショップ イベント DJ」「カフェ DJ」「店舗 周年祭 ライブ」「マルシェ ライブ」「Instagram DJ 札幌」等を組み合わせる。\n各イベントについて開催日、料金、参加方法、チケット/整理券/申込/予約の有無、正しいイベント個別URLを確認。ticketSaleを「記載なし」にしない。無料でチケット・申込不要なら「チケット不要（自由参加）」、整理券/申込等が必要なら受付情報、有料なら発売情報、未発表なら「受付開始日未発表」。featuresには確認できた「ライブ」「DJ」「ステージ」等を明記。推測禁止。\nJSONのみ:{"events":[{"eventName":"","startDate":"","endDate":"","dateLabel":"","ticketSale":"","price":"","area":"","url":"","features":""}]}`);res.json({events:await verifyEvents(data.events||[]),groups})}catch(e){res.status(500).json({error:e.message})}});
app.listen(PORT,'0.0.0.0',()=>console.log(`Event PWA running on port ${PORT}`));

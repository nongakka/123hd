const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");
const { execSync } = require("child_process");
const targetCategory = process.argv[2];
const START_TIME = Date.now();
const MAX_RUNTIME = 340 * 60 * 1000;

const categories = JSON.parse(fs.readFileSync("categories.json"));

let progress = {};

if(fs.existsSync("progress.json")){
  try{
    progress = JSON.parse(fs.readFileSync("progress.json"));
  }catch(e){
    console.log("progress.json เสีย เริ่มใหม่");
    progress = {};
  }
}

function autoCommit(){

  try{

    execSync("git config --global user.name github-actions");
    execSync("git config --global user.email actions@github.com");

    execSync("git add .");

    try{
      execSync('git commit -m "auto scraper progress"');
    }catch(e){
      console.log("ไม่มีไฟล์เปลี่ยน");
    }

    execSync("git pull --rebase");
    execSync("git push");

    console.log("commit สำเร็จ");

  }catch(e){

    console.log("commit error แต่ scraper ทำงานต่อ");

  }

}
async function runBatch(list, limit, fn){

  const results = [];

  for(let i=0;i<list.length;i+=limit){

    const chunk = list.slice(i,i+limit);

    const res = await Promise.all(chunk.map(fn));

    results.push(...res);

  }

  return results;

}


async function fetchPage(url) {

  try{

    const res = await axios.get(url,{
      headers:{
        "User-Agent":"Mozilla/5.0",
        "Referer":"https://www.123hdtv.com/"
      },
      maxRedirects:5,
      validateStatus:()=>true
    });

    if(res.status !== 200){
      console.log("HTTP",res.status,":",url);
      return "";
    }

    return typeof res.data === "string" ? res.data : "";

  }catch(e){

    console.log("โหลดหน้าไม่ได้:",url);

    if(e.code === "ERR_FR_TOO_MANY_REDIRECTS"){
      console.log("redirect loop ข้ามหน้า");
    }

    return "";

  }

}

async function fetchMoviePlayer(url){

  const html = await fetchPage(url);
  console.log("movie page loaded");
  console.log("HTML size:", html.length);
  const postMatch = html.match(/"post_url":"([^"]+)"/);

  if(postMatch){

    const postUrl = postMatch[1].replace(/\\\//g,"/");

    console.log("post url (ignore):", postUrl);

  }

  // ⭐ ต้องวางตรงนี้
  let nonce = null;

const ajaxPlayerMatch = html.match(/var\s+ajax_player\s*=\s*(\{[^}]+\})/);

if(ajaxPlayerMatch){

  try{
    const obj = JSON.parse(ajaxPlayerMatch[1]);
    nonce = obj.nonce;
  }catch(e){}

}

console.log("ajax nonce:", nonce);

// STEP 1: ดึง episode จากหน้าเว็บ
const episodeMatch = html.match(/data-episode="(\d+)"/);
const serverMatch = html.match(/data-server="(\d+)"/);
const postIdMatch2 = html.match(/data-post-id="(\d+)"/);

const episode = episodeMatch ? episodeMatch[1] : null;
const server = serverMatch ? serverMatch[1] : null;
const postid2 = postIdMatch2 ? postIdMatch2[1] : null;

console.log("episode:", episode);
console.log("server:", server);
console.log("postid (episode):", postid2);

  const postIdMatch = html.match(/post[_-]?id["']?\s*[:=]\s*["']?(\d+)/i);
  const postId = postIdMatch ? postIdMatch[1] : null;
  console.log("post id:", postId);

  console.log("has m3u8:", html.includes("m3u8"));
  console.log("has jwplayer:", html.includes("jwplayer"));

  const m3u8Match = html.match(/https?:\/\/[^"' ]+\.m3u8[^"' ]*/);

  if (m3u8Match) {
  console.log("found m3u8:", m3u8Match[0]);
  return m3u8Match[0];
}

  const $ = cheerio.load(html);

// STEP 2: ตรวจสอบ episode element
console.log("checking episode elements...");

$("span.halim-btn").each((i,el)=>{

  const ep = $(el).attr("data-episode");
  const post = $(el).attr("data-post-id");
  const server = $(el).attr("data-server");

  console.log("episode element:", ep, post, server);

});

$("script").each((i,el)=>{
  const s = $(el).html();

  if(!s) return;

  if(
    s.includes("post") ||
    s.includes("player") ||
    s.includes("embed") ||
    s.includes("ajax")
  ){
    console.log("SCRIPT FOUND:\n", s.slice(0,300));
  }
});

  let player = null;

  $("iframe").each((i,el)=>{

  if(player) return;

  const src = $(el).attr("src");

  console.log("iframe", i, ":", src);

  if(!src) return;

  if(
    src.includes("facebook") ||
    src.includes("youtube") ||
    src.includes("doubleclick") ||
    src.includes("face.php")
  ) return;

  player = src;

});

  console.log("real player:", player);

  return player;

}

async function fetchHalimPlayer(url){

  const html = await fetchPage(url);

  const $ = cheerio.load(html);

  // หา nonce
  let nonce = null;

  const ajaxMatch = html.match(/var\s+ajax_player\s*=\s*(\{[^}]+\})/);

  if(ajaxMatch){
    try{
      const obj = JSON.parse(ajaxMatch[1]);
      nonce = obj.nonce;
    }catch(e){}
  }

  if(!nonce){
    console.log("ไม่พบ nonce");
    return null;
  }

  console.log("nonce:", nonce);

  let episode = null;
  let postid = null;
  let server = "1";

  // ดึง episode จาก span.halim-btn
  $("span.halim-btn").each((i,el)=>{

    if(episode) return;

    episode = $(el).attr("data-episode");
    postid = $(el).attr("data-post-id");
    server = $(el).attr("data-server") || "1";

  });

  if(!episode || !postid){
    console.log("ไม่พบ episode");
    return null;
  }

  console.log("episode:", episode);
  console.log("postid:", postid);

  // ยิง AJAX
  const params = new URLSearchParams();

  params.append("action","halim_ajax_player");
  params.append("nonce",nonce);
  params.append("episode",episode);
  params.append("postid",postid);
  params.append("server",server);

  const res = await axios.post(
    "https://www.123hdtv.com/api/get.php",
    params.toString(),
    {
      headers:{
        "Content-Type":"application/x-www-form-urlencoded",
        "Referer": url,
        "User-Agent":"Mozilla/5.0"
      }
    }
  );

  const ajaxHtml = res.data;

  const iframeMatch = ajaxHtml.match(/src=["']([^"']+)["']/);

  if(!iframeMatch){
    console.log("ไม่พบ iframe player");
    return null;
  }

  const playerUrl = iframeMatch[1];

console.log("iframe player:", playerUrl);

if(playerUrl.includes("fileprocess.html")){
  console.log("ข้าม proxy player");
  return null;
}

  // แปลงเป็น m3u8 แบบ Android
  const idMatch = playerUrl.match(/id=([^&]+)/);

  if(idMatch){

    const id = idMatch[1];

    const m3u8 =
      `https://main.24playerhd.com/m3u8/${id}/${id}438.m3u8`;

    console.log("m3u8:", m3u8);

    return m3u8;

  }

  return playerUrl;

}

async function fetchStream(url){

  const html = await fetchPage(url);

  console.log("stream page url:", url);

  const m3u8Match = html.match(/https?:\/\/[^"' ]+\.m3u8[^"' ]*/);

  if(m3u8Match){
    console.log("found stream:", m3u8Match[0]);
    return m3u8Match[0];
  }

  console.log(html.slice(0,500));

  const $ = cheerio.load(html);

  const source = $("source").attr("src");

  if (source) return source;

  const iframe = $("iframe").attr("src");

  console.log("stream iframe:", iframe);

  return iframe;

}

async function run(category) {

  let page = progress[category.slug] || 1;
  let emptyPages = 0;
  const maxPages = 100;
  const allMovies = [];
  const seenLinks = new Set();   // ⭐ เพิ่มบรรทัดนี้
  
  const filePath = `data/movies/${category.slug}.json`;

  if(fs.existsSync(filePath)){

    try{

const oldMovies = JSON.parse(fs.readFileSync(filePath));

allMovies.push(...oldMovies);   // ⭐ เพิ่มบรรทัดนี้

for(const m of oldMovies){
  if(m.link) seenLinks.add(m.link);
}

      console.log("โหลดหนังเก่า:", seenLinks.size);

    }catch(e){
      console.log("อ่านไฟล์หนังเก่าไม่ได้");
    }

  }

while (true) {
if(Date.now() - START_TIME > MAX_RUNTIME){
    console.log("ใกล้หมดเวลา หยุดเพื่อ resume รอบหน้า");
    autoCommit();
    process.exit();
  }
if(page > maxPages){
  console.log("ถึงหน้าสูงสุดแล้ว");
  break;
}

  const url = page === 1
    ? category.url
    : `${category.url}/page/${page}`

  console.log("กำลังดึงหน้า:", url);

const html = await fetchPage(url);

if(!html){
  console.log("ข้ามหน้าเสีย:",url);
  page++;
  continue;
}

const $ = cheerio.load(html);

  const movies = [];

  $(".movie-item, .item, article").each((i,el)=>{

    const title =
      $(el).find("h2,h3,.title").text().trim();

    const link =
      $(el).find("a").attr("href");

    const image =
  	$(el).find("img").attr("src") ||
  	$(el).find("img").attr("data-src");

    if (!title) return;

    movies.push({
  title,
  link,
  image: image
    ? (image.startsWith("http") ? image : "https://www.123hdtv.com" + image)
    : null,
  player: null
});

  });

  console.log("พบ", movies.length, "เรื่อง");
  if(movies.length <= 2){
  console.log("หนังน้อยผิดปกติ อาจใกล้จบหมวด");
  }
  if (movies.length === 0) {

  console.log("หน้านี้ไม่มีข้อมูล");

  emptyPages++;

  if(emptyPages >= 5){
    console.log("ว่างหลายหน้าแล้ว หยุด");
    break;
  }

  page++;
  continue;
}

emptyPages = 0;

  // ดึง player

await runBatch(movies,5,async (movie)=>{

  if (!movie.link) return;

  console.log("กำลังดึง player:", movie.title);

  try{

    const playerPage = await fetchHalimPlayer(movie.link);

    if (playerPage) {

      if(playerPage.includes(".m3u8")){
        movie.player = playerPage;
      }else{

        const fullPlayer =
          playerPage.startsWith("http")
            ? playerPage
            : "https://www.123hdtv.com" + playerPage;

        movie.player = await fetchStream(fullPlayer);

      }

    }

  }catch(e){
    console.log("ดึง player ไม่สำเร็จ:", e);
  }

});



for (const movie of movies){

  if(!movie.link) continue;

  if(seenLinks.has(movie.link)) continue;

  seenLinks.add(movie.link);

  allMovies.push(movie);

}


  if (!fs.existsSync("data/movies"))
    fs.mkdirSync("data/movies",{recursive:true});

  fs.writeFileSync(
  `data/movies/${category.slug}.json`,
  JSON.stringify(allMovies,null,2)
);

  console.log("บันทึกสำเร็จ");

const playlist = [];

playlist.push("#EXTM3U");

for (const movie of movies){

  if (!movie.player) continue;

  playlist.push(`#EXTINF:-1 tvg-logo="${movie.image}",${movie.title}`);
  playlist.push(movie.player);

}

if (!fs.existsSync("data/playlist"))
  fs.mkdirSync("data/playlist",{recursive:true});

fs.writeFileSync(
  `data/playlist/${category.slug}.m3u`,
  playlist.join("\n")
);

console.log("สร้าง playlist แล้ว");

progress[category.slug] = page;
fs.writeFileSync("progress.json", JSON.stringify(progress,null,2));

if(page % 5 === 0){
  console.log("checkpoint commit หน้า:", page);
  autoCommit();
}

page++; // ไปหน้าถัดไป
}
}
async function start(){

  for(const category of categories){

    if(targetCategory && category.slug !== targetCategory)
      continue;

    console.log("=============");
    console.log("หมวด:", category.name);
    console.log("=============");

    await run(category);

  }

}

start();

const socket=io();
const $=id=>document.getElementById(id);
let room=null, isHost=false, myTurn=false, timer=null, remaining=60, sent=false;
const sections=["home","lobby","game","results"];
function show(id){sections.forEach(s=>$(s).classList.toggle("hidden",s!==id));}
function notice(msg){$("notice").textContent=msg;$("notice").style.display="block";setTimeout(()=>$("notice").style.display="none",3000);}
function playerName(){return $("name").value.trim()||"匿名玩家";}
$("create").onclick=()=>socket.emit("create-room",{name:playerName()});
$("join").onclick=()=>socket.emit("join-room",{code:$("roomCode").value.trim(),name:playerName()});
$("seconds").onchange=updateSettings;$("rounds").onchange=updateSettings;
function updateSettings(){socket.emit("update-settings",{seconds:$("seconds").value,rounds:$("rounds").value});}
socket.on("room-created",r=>{room=r;isHost=true;enterLobby(r);});
socket.on("joined-room",r=>{room=r;isHost=false;enterLobby(r);});
socket.on("room-update",r=>{room=r;renderRoom(r);});
function enterLobby(r){show("lobby");$("code").textContent=r.code;renderRoom(r);}
function renderRoom(r){$("code").textContent=r.code;$("players").innerHTML=r.players.map(p=>`<li>${escapeHtml(p.name)}${p.id===r.currentPlayer?"（目前回合）":""}</li>`).join("");$("hostSettings").classList.toggle("hidden",!isHost);$("waiting").classList.toggle("hidden",isHost);}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
$("start").onclick=()=>{if((room?.players.length||0)<2)return notice("至少需要 2 位玩家才能開始！");socket.emit("start-game");};
const canvas=$("canvas"),ctx=canvas.getContext("2d");ctx.lineCap="round";ctx.lineJoin="round";ctx.lineWidth=6;ctx.strokeStyle="#292638";
let drawing=false,last=null;
function pos(e){const r=canvas.getBoundingClientRect();return{x:(e.clientX-r.left)*canvas.width/r.width,y:(e.clientY-r.top)*canvas.height/r.height};}
canvas.addEventListener("pointerdown",e=>{if(!myTurn)return;drawing=true;last=pos(e);canvas.setPointerCapture(e.pointerId);ctx.beginPath();ctx.moveTo(last.x,last.y);});
canvas.addEventListener("pointermove",e=>{if(!drawing||!myTurn)return;const p=pos(e);ctx.lineTo(p.x,p.y);ctx.stroke();last=p;});
canvas.addEventListener("pointerup",()=>drawing=false);canvas.addEventListener("pointercancel",()=>drawing=false);
$("clear").onclick=()=>{if(myTurn)ctx.clearRect(0,0,canvas.width,canvas.height);};
function abstractImage(source){
 const img=new Image();img.src=source;
 return new Promise(resolve=>{img.onload=()=>{const c=document.createElement("canvas");c.width=18;c.height=11;const x=c.getContext("2d");x.drawImage(img,0,0,18,11);const d=x.getImageData(0,0,18,11).data;const out=document.createElement("canvas");out.width=900;out.height=520;const o=out.getContext("2d");o.fillStyle="#fff";o.fillRect(0,0,900,520);for(let y=0;y<11;y++)for(let xx=0;xx<18;xx++){let i=(y*18+xx)*4,r=d[i],g=d[i+1],b=d[i+2],a=d[i+3];if(a>20&&!(r>245&&g>245&&b>245)){o.fillStyle=`rgb(${Math.round(r/32)*32},${Math.round(g/32)*32},${Math.round(b/32)*32})`;o.beginPath();o.arc(xx*50+25,y*47+24,14,0,Math.PI*2);o.fill();}}resolve(out.toDataURL("image/png"));};img.onerror=()=>resolve(source);});
}
function startTimer(seconds){clearInterval(timer);remaining=seconds;$("timer").textContent=remaining;timer=setInterval(()=>{remaining--;$("timer").textContent=remaining;if(remaining<=0){clearInterval(timer);sendWork();}},1000);}
socket.on("turn-start",async data=>{
 show("game");myTurn=data.playerId===socket.id;sent=false;
 $("roundLabel").textContent=`第 ${data.round} / ${data.totalRounds} 輪`;
 $("turnLabel").textContent=myTurn?"輪到你了！":"等待其他玩家創作中……";
 $("canvas").style.opacity=myTurn?"1":".45";
 ["clear","submit"].forEach(id=>$(id).disabled=!myTurn);
 ctx.clearRect(0,0,canvas.width,canvas.height);
 $("promptBox").classList.toggle("hidden",!data.previous);
 $("firstPrompt").classList.toggle("hidden",!!data.previous);
 if(data.previous){$("promptImage").src=await abstractImage(data.previous);}
 if(myTurn)startTimer(data.duration);else{clearInterval(timer);$("timer").textContent="等待中";}
});
$("submit").onclick=sendWork;
async function sendWork(){if(!myTurn||sent)return;sent=true;clearInterval(timer);const image=canvas.toDataURL("image/png");const abstract=await abstractImage(image);socket.emit("submit-drawing",{image,abstract});myTurn=false;$("turnLabel").textContent="作品已送出，等待下一位！";}
socket.on("game-finished",({works})=>{clearInterval(timer);show("results");$("works").innerHTML=works.map((w,i)=>`<article class="work"><b>${i+1}. ${escapeHtml(w.playerName)}</b><p>原始作品</p><img src="${w.image}"><p>幾何線索</p><img src="${w.abstract}"></article>`).join("");});
socket.on("error-message",notice);
$("backHome").onclick=()=>location.reload();
socket.on("connect_error",()=>notice("連線失敗，請重新整理頁面。"));

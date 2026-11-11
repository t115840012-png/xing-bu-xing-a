const socket = io();
const $ = id => document.getElementById(id);
let room = null, isHost = false, myTurn = false, timer = null, remaining = 60, sent = false, currentRound = 1;
const sections = ["home","lobby","game","results"];
function show(id){sections.forEach(s => $(s).classList.toggle("hidden", s !== id));}
function notice(msg){$("notice").textContent=msg;$("notice").style.display="block";setTimeout(()=>$("notice").style.display="none",3000);}
function playerName(){return $("name").value.trim() || "匿名玩家";}
$("create").onclick=()=>socket.emit("create-room",{name:playerName()});
$("join").onclick=()=>socket.emit("join-room",{code:$("roomCode").value.trim(),name:playerName()});
$("seconds").onchange=updateSettings;$("rounds").onchange=updateSettings;
function updateSettings(){socket.emit("update-settings",{seconds:$("seconds").value,rounds:$("rounds").value});}
socket.on("room-created",r=>{room=r;isHost=true;enterLobby(r);});
socket.on("joined-room",r=>{room=r;isHost=false;enterLobby(r);});
socket.on("room-update",r=>{room=r;renderRoom(r);});
function enterLobby(r){show("lobby");$("code").textContent=r.code;renderRoom(r);}
function renderRoom(r){$("code").textContent=r.code;$("players").innerHTML=r.players.map(p=>`<li>${escapeHtml(p.name)}</li>`).join("");$("hostSettings").classList.toggle("hidden",!isHost);$("waiting").classList.toggle("hidden",isHost);}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
$("start").onclick=()=>{if((room?.players.length||0)<2)return notice("至少需要 2 位玩家才能開始！");socket.emit("start-game");};

const canvas=$("canvas"),ctx=canvas.getContext("2d",{willReadFrequently:true});
let drawing=false,last=null,tool="brush",brushColor="#292638",brushSize=7;
let undoStack=[],redoStack=[],strokeBefore=null;
const HISTORY_LIMIT=40;
function snapshotCanvas(){return ctx.getImageData(0,0,canvas.width,canvas.height);}
function saveHistory(before){
  if(!before)return;
  undoStack.push(before);
  if(undoStack.length>HISTORY_LIMIT)undoStack.shift();
  redoStack=[];
  updateHistoryButtons();
}
function restoreSnapshot(image){ctx.putImageData(image,0,0);}
function undo(){if(!myTurn||sent||!undoStack.length)return;redoStack.push(snapshotCanvas());restoreSnapshot(undoStack.pop());updateHistoryButtons();}
function redo(){if(!myTurn||sent||!redoStack.length)return;undoStack.push(snapshotCanvas());restoreSnapshot(redoStack.pop());updateHistoryButtons();}
function updateHistoryButtons(){
  if($("undo"))$("undo").disabled=!myTurn||sent||undoStack.length===0;
  if($("redo"))$("redo").disabled=!myTurn||sent||redoStack.length===0;
}
function resetHistory(){undoStack=[];redoStack=[];strokeBefore=null;updateHistoryButtons();}
function pos(e){const r=canvas.getBoundingClientRect();return{x:Math.max(0,Math.min(canvas.width,(e.clientX-r.left)*canvas.width/r.width)),y:Math.max(0,Math.min(canvas.height,(e.clientY-r.top)*canvas.height/r.height))};}
function setTool(next){tool=next;document.querySelectorAll("[data-tool]").forEach(b=>b.classList.toggle("active",b.dataset.tool===tool));canvas.style.cursor=tool==="bucket"?"cell":tool==="eraser"?"crosshair":"crosshair";}
document.querySelectorAll("[data-tool]").forEach(b=>b.onclick=()=>setTool(b.dataset.tool));
$("brushSize").oninput=e=>{brushSize=Number(e.target.value);$("brushSizeValue").textContent=brushSize;};
$("colorPicker").oninput=e=>{brushColor=e.target.value;setTool("brush");};
document.querySelectorAll(".swatch").forEach(b=>b.onclick=()=>{brushColor=b.dataset.color;$("colorPicker").value=brushColor;setTool("brush");});
function drawSegment(a,b){ctx.save();ctx.lineCap="round";ctx.lineJoin="round";ctx.lineWidth=brushSize;ctx.strokeStyle=tool==="eraser"?"#ffffff":brushColor;ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();ctx.restore();}
function floodFill(x,y,color){
  const w=canvas.width,h=canvas.height, image=ctx.getImageData(0,0,w,h), d=image.data;
  const px=Math.floor(x),py=Math.floor(y),start=(py*w+px)*4;
  const target=[d[start],d[start+1],d[start+2],d[start+3]];
  const hex=color.replace("#",""),fill=[parseInt(hex.slice(0,2),16),parseInt(hex.slice(2,4),16),parseInt(hex.slice(4,6),16),255];
  if(target.every((v,i)=>v===fill[i]))return;
  const tolerance=28, stack=[[px,py]], seen=new Uint8Array(w*h);
  while(stack.length){
    const [cx,cy]=stack.pop();if(cx<0||cy<0||cx>=w||cy>=h)continue;
    const pi=cy*w+cx;if(seen[pi])continue;seen[pi]=1;
    const k=pi*4;
    if(Math.abs(d[k]-target[0])>tolerance||Math.abs(d[k+1]-target[1])>tolerance||Math.abs(d[k+2]-target[2])>tolerance||Math.abs(d[k+3]-target[3])>tolerance)continue;
    d[k]=fill[0];d[k+1]=fill[1];d[k+2]=fill[2];d[k+3]=255;
    stack.push([cx+1,cy],[cx-1,cy],[cx,cy+1],[cx,cy-1]);
  }
  ctx.putImageData(image,0,0);
}
canvas.addEventListener("pointerdown",e=>{
  if(!myTurn||sent)return;
  const p=pos(e);
  if(tool==="bucket"){floodFill(p.x,p.y,brushColor);return;}
  drawing=true;last=p;canvas.setPointerCapture(e.pointerId);drawSegment(p,{x:p.x+0.01,y:p.y+0.01});
});
canvas.addEventListener("pointermove",e=>{if(!drawing||!myTurn||sent)return;const p=pos(e);drawSegment(last,p);last=p;});
canvas.addEventListener("pointerup",()=>drawing=false);
canvas.addEventListener("pointercancel",()=>drawing=false);
function clearCanvas(){ctx.fillStyle="#ffffff";ctx.fillRect(0,0,canvas.width,canvas.height);}
$("clear").onclick=()=>{if(myTurn)clearCanvas();};

async function abstractImage(source){
  const img=new Image();img.src=source;
  return new Promise(resolve=>{
    img.onload=()=>{
      // 先縮小取樣，再用最近鄰放大，形成清楚的大型像素方塊。
      // 30 x 17 的取樣尺寸，約每 30 x 30 畫布像素合成一格。
      const small=document.createElement("canvas");
      small.width=30;small.height=17;
      const s=small.getContext("2d");
      s.fillStyle="#fff";s.fillRect(0,0,small.width,small.height);
      s.drawImage(img,0,0,small.width,small.height);

      const out=document.createElement("canvas");
      out.width=900;out.height=520;
      const o=out.getContext("2d");
      o.imageSmoothingEnabled=false;
      o.fillStyle="#fff";o.fillRect(0,0,out.width,out.height);
      o.drawImage(small,0,0,out.width,out.height);
      resolve(out.toDataURL("image/png"));
    };
    img.onerror=()=>resolve(source);
  });
}

function startTimer(seconds){
  clearInterval(timer);remaining=seconds;$("timer").textContent=remaining;
  timer=setInterval(()=>{remaining--;$("timer").textContent=remaining;if(remaining<=0){clearInterval(timer);sendWork();}},1000);
}
socket.on("turn-start",async data=>{
  show("game");myTurn=true;sent=false;currentRound=data.round;
  $("roundLabel").textContent=`第 ${data.round} / ${data.totalRounds} 次作畫`;
  $("turnLabel").textContent="大家一起畫！";
  $("canvas").style.opacity="1";
  ["clear","submit","undo","redo"].forEach(id=>$(id).disabled=false);
  clearCanvas();
  $("promptBox").classList.toggle("hidden",!data.previous);
  $("firstPrompt").classList.toggle("hidden",!!data.previous);
  if(data.previous){$("promptImage").src=data.previous;}
  if(!data.previous)$("firstPrompt").textContent="第一輪開始！請自由畫下第一張作品。";
  setTool("brush");startTimer(data.duration);
});
$("submit").onclick=sendWork;
async function sendWork(){
  if(!myTurn||sent)return;
  sent=true;drawing=false;clearInterval(timer);
  $("submit").disabled=true;$("clear").disabled=true;$("undo").disabled=true;$("redo").disabled=true;
  $("turnLabel").textContent="已送出！等待其他玩家完成……";
  const image=canvas.toDataURL("image/png"),abstract=await abstractImage(image);
  socket.emit("submit-drawing",{image,abstract,round:currentRound});
  myTurn=false;
}
socket.on("drawing-received",()=>notice("作品已收到！"));
socket.on("work-added",({count,total})=>{$("progressLabel").textContent=`已完成 ${count} / ${total} 人`;});
socket.on("round-started",({round,totalRounds})=>{$("progressLabel").textContent=`第 ${round} 次作畫／共 ${totalRounds} 次`;});
socket.on("game-finished",({works})=>{
  clearInterval(timer);myTurn=false;show("results");
  $("works").innerHTML=works.map((w,i)=>`<article class="work"><b>第 ${w.round} 輪・${escapeHtml(w.playerName)}</b><p>原始作品</p><img src="${w.image}" alt="原始作品"><p>抽象線索</p><img class="abstract" src="${w.abstract}" alt="馬賽克線索"></article>`).join("");
});
socket.on("error-message",notice);
$("backHome").onclick=()=>location.reload();
socket.on("connect_error",()=>notice("連線失敗，請重新整理頁面。"));

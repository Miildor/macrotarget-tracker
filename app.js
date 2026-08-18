/* ============================================================
   Tracker de Recomposición — lógica (vanilla JS + Supabase)
   ============================================================ */
const cfg = window.APP_CONFIG || {};
if (!cfg.SUPABASE_URL || cfg.SUPABASE_URL.includes("TU-PROYECTO")) {
  alert("Falta configurar config.js con tu SUPABASE_URL y SUPABASE_ANON_KEY.");
}
const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

// ---------- estado ----------
const state = { user:null, profile:null, foods:[], foodsByName:{}, chart:null };
const $ = (id) => document.getElementById(id);
const todayISO = () => new Date().toISOString().slice(0,10);
const num = (v) => (v===""||v==null||isNaN(+v)) ? null : +v;
const r0 = (x)=>Math.round(x);
const r1 = (x)=>Math.round(x*10)/10;

function toast(msg){ const t=$("toast"); t.textContent=msg; t.classList.remove("hidden");
  clearTimeout(t._h); t._h=setTimeout(()=>t.classList.add("hidden"),2200); }

// ============================================================
//  AUTH
// ============================================================
async function initAuth(){
  const { data:{ session } } = await sb.auth.getSession();
  if (session) { await onSignedIn(session.user); }
  else { showAuth(); }
  sb.auth.onAuthStateChange((_e, sess)=>{
    if (sess?.user && !state.user) onSignedIn(sess.user);
    if (!sess) showAuth();
  });
}
function showAuth(){ state.user=null; $("app-view").classList.add("hidden"); $("auth-view").classList.remove("hidden"); }
function authError(msg){ const e=$("auth-error"); e.textContent=msg; e.classList.toggle("hidden",!msg); }

$("btn-login").onclick = async ()=>{
  authError("");
  const { error } = await sb.auth.signInWithPassword({ email:$("auth-email").value.trim(), password:$("auth-password").value });
  if (error) authError(traducirError(error.message));
};
$("btn-signup").onclick = async ()=>{
  authError("");
  const { error } = await sb.auth.signUp({ email:$("auth-email").value.trim(), password:$("auth-password").value });
  if (error) authError(traducirError(error.message));
  else $("auth-hint").textContent = "Cuenta creada. Si tu proyecto pide confirmación por correo, revisa tu bandeja y luego entra.";
};
$("btn-logout").onclick = async ()=>{ await sb.auth.signOut(); state.user=null; location.reload(); };

function traducirError(m){
  if(/Invalid login/i.test(m)) return "Correo o contraseña incorrectos.";
  if(/already registered/i.test(m)) return "Ese correo ya tiene cuenta. Entra normal.";
  if(/at least 6/i.test(m)) return "La contraseña debe tener al menos 6 caracteres.";
  return m;
}

async function onSignedIn(user){
  state.user = user;
  $("auth-view").classList.add("hidden");
  $("app-view").classList.remove("hidden");
  $("user-email").textContent = user.email;
  $("log-date").value = todayISO();
  $("w-date").value = todayISO();
  const monthAgo = new Date(Date.now()-30*864e5).toISOString().slice(0,10);
  $("exp-from").value = monthAgo;
  $("exp-to").value = todayISO();
  await ensureProfile();
  await loadFoods();
  fillConfigForm();
  await refreshDay();
  await refreshWeight();
}

// ============================================================
//  PERFIL / OBJETIVOS
// ============================================================
async function ensureProfile(){
  const { data } = await sb.from("profiles").select("*").eq("user_id", state.user.id).maybeSingle();
  if (data){ state.profile = data; return; }
  const def = { user_id: state.user.id };
  const { data:created } = await sb.from("profiles").insert(def).select().single();
  state.profile = created;
}
function carbTarget(p){ return Math.max(0, (p.kcal_target - p.protein_target*4 - p.fat_target*9)/4); }

function fillConfigForm(){
  const p=state.profile;
  $("cfg-kcal").value=p.kcal_target; $("cfg-p").value=p.protein_target; $("cfg-f").value=p.fat_target;
  $("cfg-h").value=p.height_m; $("cfg-rmin").value=p.rate_min; $("cfg-rmax").value=p.rate_max;
  $("cfg-cut").value=p.cut_threshold; $("cfg-waist").value=p.waist_alert; $("cfg-step").value=p.kcal_step;
}
$("btn-cfg").onclick = async ()=>{
  const patch={
    kcal_target:num($("cfg-kcal").value), protein_target:num($("cfg-p").value), fat_target:num($("cfg-f").value),
    height_m:num($("cfg-h").value), rate_min:num($("cfg-rmin").value), rate_max:num($("cfg-rmax").value),
    cut_threshold:num($("cfg-cut").value), waist_alert:num($("cfg-waist").value), kcal_step:num($("cfg-step").value),
    updated_at:new Date().toISOString()
  };
  const { error } = await sb.from("profiles").update(patch).eq("user_id", state.user.id);
  if (error) return toast("Error al guardar");
  Object.assign(state.profile, patch);
  toast("Ajustes guardados"); await refreshDay(); await refreshWeight();
};

// ============================================================
//  ALIMENTOS (base)
// ============================================================
async function loadFoods(){
  const { data } = await sb.from("foods").select("*").order("name");
  state.foods = data||[];
  state.foodsByName = {};
  const dl = $("food-list"); dl.innerHTML="";
  state.foods.forEach(f=>{
    state.foodsByName[f.name.toLowerCase()] = f;
    const o=document.createElement("option"); o.value=f.name; dl.appendChild(o);
  });
  renderFoodTable();
}
function findFood(name){ return state.foodsByName[(name||"").trim().toLowerCase()] || null; }

$("add-food").addEventListener("input", ()=>{
  const f=findFood($("add-food").value);
  $("add-ref").textContent = f ? `1 ${f.unit_label} = ${f.grams_per_unit} g · por 100 g: ${r0(f.kcal_100)} kcal, ${f.protein_100} P` : "";
});

function macrosFor(food, qty, unit){
  const grams = unit==="porcion" ? qty*(food.grams_per_unit||100) : qty;
  return { grams,
    kcal:food.kcal_100*grams/100, protein:food.protein_100*grams/100,
    carbs:food.carbs_100*grams/100, fat:food.fat_100*grams/100 };
}

$("btn-add").onclick = async ()=>{
  const food=findFood($("add-food").value);
  const qty=num($("add-qty").value);
  if(!food) return toast("Elige un alimento de la lista");
  if(!qty)  return toast("Escribe la cantidad");
  const unit=$("add-unit").value;
  const m=macrosFor(food, qty, unit);
  const row={ user_id:state.user.id, log_date:$("log-date").value, meal:$("add-meal").value,
    food_id:food.id, food_name:food.name, quantity:qty, unit,
    grams:r1(m.grams), kcal:r1(m.kcal), protein:r1(m.protein), carbs:r1(m.carbs), fat:r1(m.fat) };
  const { error } = await sb.from("food_log").insert(row);
  if(error) return toast("Error al añadir");
  $("add-food").value=""; $("add-qty").value=""; $("add-ref").textContent="";
  toast("Añadido"); await refreshDay();
};

$("btn-newfood").onclick = async ()=>{
  const row={ user_id:state.user.id, name:$("nf-name").value.trim(), category:$("nf-cat").value.trim()||null,
    kcal_100:num($("nf-kcal").value), protein_100:num($("nf-p").value), carbs_100:num($("nf-c").value),
    fat_100:num($("nf-f").value), unit_label:$("nf-unit").value.trim()||"porción", grams_per_unit:num($("nf-gpu").value)||100 };
  if(!row.name || row.kcal_100==null) return toast("Faltan nombre y kcal");
  const { error } = await sb.from("foods").insert(row);
  if(error) return toast("Error: ¿nombre repetido?");
  ["nf-name","nf-cat","nf-kcal","nf-p","nf-c","nf-f","nf-unit","nf-gpu"].forEach(id=>$(id).value="");
  toast("Alimento agregado"); await loadFoods();
};

function renderFoodTable(){
  const mine = state.foods.filter(f=>f.user_id===state.user.id);
  const el=$("food-table");
  el.innerHTML = `<h3>Mis alimentos (${mine.length})</h3>` + (mine.length? `
    <table><thead><tr><th>Alimento</th><th class="num">kcal</th><th class="num">P</th><th class="num">C</th><th class="num">G</th><th></th></tr></thead>
    <tbody>${mine.map(f=>`<tr>
      <td>${esc(f.name)}<div class="l-sub">1 ${esc(f.unit_label)} = ${f.grams_per_unit} g</div></td>
      <td class="num">${r0(f.kcal_100)}</td><td class="num">${f.protein_100}</td><td class="num">${f.carbs_100}</td><td class="num">${f.fat_100}</td>
      <td><button class="l-del" data-del-food="${f.id}">✕</button></td></tr>`).join("")}</tbody></table>`
    : `<p class="empty">Aún no agregas alimentos propios. Los de la lista global ya están disponibles al registrar.</p>`);
  el.querySelectorAll("[data-del-food]").forEach(b=>b.onclick=async()=>{
    await sb.from("foods").delete().eq("id", b.dataset.delFood); toast("Eliminado"); await loadFoods();
  });
}

// ============================================================
//  DÍA (registro + macros)
// ============================================================
$("log-date").addEventListener("change", refreshDay);

async function refreshDay(){
  const date=$("log-date").value;
  const { data:log } = await sb.from("food_log").select("*").eq("user_id",state.user.id).eq("log_date",date).order("created_at");
  renderMacros(log||[]);
  renderLog(log||[]);
}

function renderMacros(log){
  const p=state.profile;
  const sum=(k)=>log.reduce((a,r)=>a+(+r[k]||0),0);
  const eaten={kcal:sum("kcal"),p:sum("protein"),c:sum("carbs"),f:sum("fat")};
  const goal={kcal:p.kcal_target,p:p.protein_target,c:carbTarget(p),f:p.fat_target};
  setMacro("kcal",eaten.kcal,goal.kcal,0);
  setMacro("p",eaten.p,goal.p,1);
  setMacro("c",eaten.c,goal.c,1);
  setMacro("f",eaten.f,goal.f,1);
}
function setMacro(key,eaten,goal,dec){
  const round=dec?r1:r0;
  $(key+"-eaten").textContent=round(eaten);
  $(key+"-goal").textContent=round(goal);
  const rem=goal-eaten;
  const remEl=$(key+"-rem");
  remEl.textContent=(rem>=0?`faltan ${round(rem)}`:`+${round(-rem)} de más`);
  const pct=goal>0?Math.min(100,eaten/goal*100):0;
  const bar=$(key+"-bar"); bar.style.width=pct+"%";
  bar.classList.toggle("over", eaten>goal*1.05);
  bar.classList.toggle("ok", eaten>=goal*0.9 && eaten<=goal*1.05);
}

const MEAL_ORDER=["Desayuno","Comida","Snack","Cena"];
function renderLog(log){
  const el=$("log-list");
  if(!log.length){ el.innerHTML=`<div class="card empty">Sin registros este día. Añade tu primer alimento arriba.</div>`; return; }
  const byMeal={}; log.forEach(r=>{ (byMeal[r.meal] ||= []).push(r); });
  el.innerHTML = MEAL_ORDER.filter(m=>byMeal[m]).map(m=>{
    const rows=byMeal[m];
    const k=rows.reduce((a,r)=>a+(+r.kcal||0),0), pr=rows.reduce((a,r)=>a+(+r.protein||0),0);
    return `<div class="meal-block">
      <div class="meal-head"><span>${m}</span><span class="mono">${r0(k)} kcal · ${r1(pr)} P</span></div>
      ${rows.map(r=>`<div class="log-row">
        <div class="l-name"><b>${esc(r.food_name)}</b>
          <div class="l-sub">${r.quantity} ${r.unit==="porcion"?"porción":"g"} · ${r1(r.grams)} g</div></div>
        <div class="l-macros">${r0(r.kcal)} kcal<br>${r1(r.protein)}P · ${r1(r.carbs)}C · ${r1(r.fat)}G</div>
        <button class="l-del" data-del="${r.id}">✕</button>
      </div>`).join("")}
    </div>`;
  }).join("");
  el.querySelectorAll("[data-del]").forEach(b=>b.onclick=async()=>{
    await sb.from("food_log").delete().eq("id",b.dataset.del); toast("Eliminado"); await refreshDay();
  });
}

// ============================================================
//  PESO + motor de recomendación semanal
// ============================================================
$("btn-weight").onclick = async ()=>{
  const row={ user_id:state.user.id, log_date:$("w-date").value,
    weight_kg:num($("w-kg").value), waist_cm:num($("w-waist").value) };
  if(row.weight_kg==null && row.waist_cm==null) return toast("Escribe peso o cintura");
  const { error } = await sb.from("weight_log").upsert(row,{ onConflict:"user_id,log_date" });
  if(error) return toast("Error al guardar");
  $("w-kg").value=""; $("w-waist").value=""; toast("Guardado"); await refreshWeight();
};

function isoWeekKey(d){ // lunes como inicio
  const dt=new Date(d+"T00:00:00"); const day=(dt.getDay()+6)%7;
  dt.setDate(dt.getDate()-day); return dt.toISOString().slice(0,10);
}
async function refreshWeight(){
  const { data } = await sb.from("weight_log").select("*").eq("user_id",state.user.id).order("log_date");
  const rows=data||[];
  drawChart(rows);
  const weeks=weeklyAverages(rows);
  renderReco(weeks);
  renderWeeklyTable(weeks);
}
function weeklyAverages(rows){
  const groups={};
  rows.forEach(r=>{ const k=isoWeekKey(r.log_date);
    (groups[k] ||= {wk:k, w:[], waist:[]});
    if(r.weight_kg!=null) groups[k].w.push(+r.weight_kg);
    if(r.waist_cm!=null) groups[k].waist.push(+r.waist_cm);
  });
  return Object.values(groups).sort((a,b)=>a.wk<b.wk?-1:1).map(g=>({
    wk:g.wk,
    avg:g.w.length? g.w.reduce((a,b)=>a+b,0)/g.w.length : null,
    waist:g.waist.length? g.waist[g.waist.length-1] : null
  }));
}
function renderReco(weeks){
  const p=state.profile, el=$("reco-banner");
  const withAvg=weeks.filter(w=>w.avg!=null);
  if(withAvg.length<2){ el.className="reco"; el.innerHTML=`<div>Registra peso al menos 2 semanas para tu primera recomendación.</div>
    <div class="reco-sub">Pésate 4–5 mañanas por semana; se promedia solo.</div>`; return; }
  const cur=withAvg[withAvg.length-1], prev=withAvg[withAvg.length-2];
  const dW=cur.avg-prev.avg;
  const dWaist=(cur.waist!=null&&prev.waist!=null)? cur.waist-prev.waist : null;
  let cls,msg,step=0;
  if(dWaist!=null && dWaist>=p.waist_alert && dW>0){ cls="down"; step=-p.kcal_step; msg="Cintura subiendo rápido: recorta 150 kcal"; }
  else if(dW < p.rate_min){ cls="up"; step=p.kcal_step; msg="Ganancia lenta: sube 150 kcal"; }
  else if(dW > p.cut_threshold){ cls="down"; step=-p.kcal_step; msg="Subiendo rápido: baja 150 kcal"; }
  else { cls="ideal"; msg="Ritmo ideal: mantén tus calorías"; }
  const suggested=p.kcal_target+step;
  el.className="reco "+cls;
  el.innerHTML=`<div>${msg}</div>
    <div class="reco-sub">Cambio semanal: ${dW>=0?"+":""}${r1(dW)} kg${dWaist!=null?` · cintura ${dWaist>=0?"+":""}${r1(dWaist)} cm`:""}.
    ${step!==0?`Sugerido: <b>${suggested} kcal</b> (ve a Ajustes para aplicarlo).`:`Meta actual: <b>${p.kcal_target} kcal</b>.`}</div>`;
}
function renderWeeklyTable(weeks){
  const el=$("weekly-table");
  if(!weeks.length){ el.innerHTML=`<h3>Semanas</h3><p class="empty">Sin datos aún.</p>`; return; }
  const rows=weeks.slice(-8).reverse().map((w,i,arr)=>{
    const prev=arr[i+1];
    const d=(w.avg!=null&&prev&&prev.avg!=null)? w.avg-prev.avg : null;
    return `<tr><td>${w.wk}</td><td class="num">${w.avg!=null?r1(w.avg):"—"}</td>
      <td class="num">${d!=null?(d>=0?"+":"")+r1(d):"—"}</td>
      <td class="num">${w.waist!=null?r1(w.waist):"—"}</td></tr>`;
  }).join("");
  el.innerHTML=`<h3>Semanas (promedio)</h3>
    <table><thead><tr><th>Semana</th><th class="num">Peso</th><th class="num">Δ kg</th><th class="num">Cintura</th></tr></thead>
    <tbody>${rows}</tbody></table>`;
}
function drawChart(rows){
  const pts=rows.filter(r=>r.weight_kg!=null);
  const ctx=$("weight-chart");
  const labels=pts.map(r=>r.log_date.slice(5));
  const data=pts.map(r=>+r.weight_kg);
  if(state.chart) state.chart.destroy();
  if(!pts.length){ return; }
  state.chart=new Chart(ctx,{ type:"line",
    data:{ labels, datasets:[{ label:"Peso (kg)", data, borderColor:"#1f6f78",
      backgroundColor:"rgba(31,111,120,.12)", tension:.25, fill:true, pointRadius:2 }]},
    options:{ responsive:true, plugins:{legend:{display:false}},
      scales:{ y:{ ticks:{font:{family:"IBM Plex Mono"}} }, x:{ ticks:{font:{family:"IBM Plex Mono"},maxTicksLimit:8} } } }
  });
}

// ---------- tabs ----------
document.querySelectorAll(".tab").forEach(t=>t.onclick=()=>{
  document.querySelectorAll(".tab").forEach(x=>x.classList.remove("is-active"));
  t.classList.add("is-active");
  document.querySelectorAll(".tabpanel").forEach(p=>p.classList.add("hidden"));
  $("tab-"+t.dataset.tab).classList.remove("hidden");
  if(t.dataset.tab==="peso") refreshWeight();
});

function esc(s){ return (s||"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }

// ============================================================
//  EXPORTAR CSV
// ============================================================
function csvCell(v){
  if(v==null) return "";
  const s=String(v);
  return /[",\n;]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s;
}
function downloadCSV(filename, headers, rows){
  const bom="\uFEFF"; // acentos correctos en Excel
  const body=[headers.join(","), ...rows.map(r=>r.map(csvCell).join(","))].join("\r\n");
  const blob=new Blob([bom+body],{type:"text/csv;charset=utf-8"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a"); a.href=url; a.download=filename; a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1500);
}
function expRange(){ return { from:$("exp-from").value, to:$("exp-to").value }; }

$("btn-export-food").onclick = async ()=>{
  const {from,to}=expRange();
  if(!from||!to) return toast("Elige el rango de fechas");
  const { data, error } = await sb.from("food_log").select("*")
    .eq("user_id",state.user.id).gte("log_date",from).lte("log_date",to)
    .order("log_date").order("created_at");
  if(error) return toast("Error al exportar");
  if(!data.length) return toast("Sin comidas en ese rango");
  const rows=data.map(r=>[r.log_date,r.meal,r.food_name,r.quantity,
    r.unit==="porcion"?"porción":"g",r.grams,r.kcal,r.protein,r.carbs,r.fat]);
  downloadCSV(`comidas_${from}_a_${to}.csv`,
    ["Fecha","Comida","Alimento","Cantidad","Unidad","Gramos","kcal","Proteina_g","Carbs_g","Grasa_g"], rows);
  toast(`${data.length} registros exportados`);
};

$("btn-export-weight").onclick = async ()=>{
  const {from,to}=expRange();
  if(!from||!to) return toast("Elige el rango de fechas");
  const { data, error } = await sb.from("weight_log").select("*")
    .eq("user_id",state.user.id).gte("log_date",from).lte("log_date",to).order("log_date");
  if(error) return toast("Error al exportar");
  if(!data.length) return toast("Sin registros de peso en ese rango");
  const rows=data.map(r=>[r.log_date,r.weight_kg,r.waist_cm]);
  downloadCSV(`peso_${from}_a_${to}.csv`, ["Fecha","Peso_kg","Cintura_cm"], rows);
  toast(`${data.length} registros exportados`);
};

// ============================================================
//  PWA — service worker
// ============================================================
if("serviceWorker" in navigator){
  window.addEventListener("load",()=>{
    navigator.serviceWorker.register("./sw.js").catch(()=>{ /* sin conexión: se ignora */ });
  });
}

// ---------- go ----------
initAuth();

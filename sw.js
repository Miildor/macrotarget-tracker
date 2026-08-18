const CACHE="recomp-v1";
const ASSETS=["./","./index.html","./styles.css","./app.js","./config.js",
  "./manifest.json","./icon-192.png","./icon-512.png"];
self.addEventListener("install",e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()));
});
self.addEventListener("activate",e=>{
  e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener("fetch",e=>{
  const u=new URL(e.request.url);
  // nunca cachear llamadas a Supabase ni a CDNs de datos
  if(u.origin!==location.origin){ return; }
  e.respondWith(
    fetch(e.request).then(r=>{
      const cp=r.clone(); caches.open(CACHE).then(c=>c.put(e.request,cp)); return r;
    }).catch(()=>caches.match(e.request).then(m=>m||caches.match("./index.html")))
  );
});
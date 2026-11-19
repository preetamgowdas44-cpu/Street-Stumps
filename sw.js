const CACHE='street-stumps-v9';
const APP_SHELL=['./','./index.html','./manifest.webmanifest','./street-stumps-emblem.png','./street-stumps-icon.png','./street-stumps-app-icon.png','./street-stumps-wordmark.png'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(APP_SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('street-stumps-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET')return;
  const url=new URL(request.url);
  if(url.origin!==self.location.origin)return;
  const navigation=request.mode==='navigate'||url.pathname.endsWith('/index.html')||url.pathname.endsWith('/');
  if(navigation){
    event.respondWith(fetch(request).then(response=>{
      if(response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put('./index.html',copy)).catch(()=>{});}
      return response;
    }).catch(async()=>{const cache=await caches.open(CACHE);return await cache.match('./index.html')||await cache.match(request)}));
    return;
  }
  event.respondWith(caches.open(CACHE).then(async cache=>{
    const cached=await cache.match(request);
    if(cached)return cached;
    try{
      const response=await fetch(request);
      if(response.ok)cache.put(request,response.clone()).catch(()=>{});
      return response;
    }catch{return Response.error();}
  }));
});



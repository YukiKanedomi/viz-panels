// 帰宅ナビ Service Worker: stale-while-revalidate（キャッシュ即応・裏で更新）
var C = 'tsukin-navi-v1';
self.addEventListener('install', function(e){
  e.waitUntil(caches.open(C).then(function(c){return c.addAll(['./tsukin-navi.html']);}).then(function(){return self.skipWaiting();}));
});
self.addEventListener('activate', function(e){
  e.waitUntil(caches.keys().then(function(ks){
    return Promise.all(ks.filter(function(k){return k!==C && k.indexOf('tsukin-navi')===0;}).map(function(k){return caches.delete(k);}));
  }).then(function(){return self.clients.claim();}));
});
self.addEventListener('fetch', function(e){
  if(e.request.method!=='GET') return;
  if(e.request.url.indexOf('tsukin-navi')<0) return;
  e.respondWith(caches.match(e.request).then(function(hit){
    var net=fetch(e.request).then(function(r){
      if(r && r.ok) caches.open(C).then(function(c){c.put(e.request,r.clone());});
      return r;
    }).catch(function(){return hit;});
    return hit || net;
  }));
});

/* RitelAI Chart Vision — Web Push service worker */
self.addEventListener("install",event=>{event.waitUntil(self.skipWaiting());});
self.addEventListener("activate",event=>{event.waitUntil(self.clients.claim());});
self.addEventListener("push",event=>{
 let payload={};
 try{payload=event.data?event.data.json():{};}catch{payload={body:event.data?.text?.()||"Ada agenda ekonomi yang akan segera dirilis."};}
 const title=String(payload.title||"RitelAI · Pengingat News");
 const options={
  body:String(payload.body||"Periksa kalender ekonomi RitelAI."),
  tag:String(payload.tag||"ritelai-news-reminder"),
  renotify:true,
  data:{url:String(payload.url||"./?tab=news")}
 };
 event.waitUntil(self.registration.showNotification(title,options));
});
self.addEventListener("notificationclick",event=>{
 event.notification.close();
 const target=new URL(event.notification.data?.url||"./?tab=news",self.registration.scope).href;
 event.waitUntil((async()=>{
  const clientsList=await self.clients.matchAll({type:"window",includeUncontrolled:true});
  for(const client of clientsList){if("focus" in client){await client.navigate(target);return client.focus();}}
  if(self.clients.openWindow)return self.clients.openWindow(target);
 })());
});

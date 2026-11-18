self.addEventListener("push",event=>{
 let data={title:"RitelAI Market Alert",body:"Ada pembaruan berita pasar.",url:"/"};
 try{data={...data,...(event.data?event.data.json():{})}}catch{}
 event.waitUntil(self.registration.showNotification(data.title,{
  body:data.body,icon:"/icon-192.png",badge:"/icon-192.png",
  tag:data.tag||"ritelai-market-news",renotify:false,
  data:{url:data.url||"/"},vibrate:[200,100,200],
  requireInteraction:data.priority==="high"
 }));
});
self.addEventListener("notificationclick",event=>{
 event.notification.close();
 const target=new URL(event.notification.data?.url||"/",self.location.origin).href;
 event.waitUntil(clients.matchAll({type:"window",includeUncontrolled:true}).then(list=>{
  for(const client of list){if(new URL(client.url).origin===self.location.origin){client.navigate(target);return client.focus()}}
  return clients.openWindow(target);
 }));
});
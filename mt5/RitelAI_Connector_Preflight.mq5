//+------------------------------------------------------------------+
//| RitelAI MT5 Connector - DEMO bridge preflight                     |
//| Pairing + heartbeat + signal inbox. NO trade execution.           |
//+------------------------------------------------------------------+
#property strict
#property version   "0.2.1"
#property description "RitelAI demo-only bridge connector. Displays signals; never places orders."

enum RITELAI_PROFILE { EXNESS_STANDARD_CENT=0, VERSUS_TRADE_STANDARD=1 };
input string InpBridgeUrl="https://brfssdpplapefjmxnpft.supabase.co/functions/v1/mt5-bridge";
input string InpPairingCode="";
input RITELAI_PROFILE InpAccountProfile=EXNESS_STANDARD_CENT;
input string InpPreferredSymbol="XAUUSD";
input int InpPollSeconds=5;
input bool InpRequireDemoAccount=true;

bool g_demo=false;
string g_broker="UNKNOWN",g_profile="UNKNOWN",g_symbol="",g_token="",g_status="Starting";
string Esc(string s){StringReplace(s,"\\","\\\\");StringReplace(s,"\"","\\\"");StringReplace(s,"\r","\\r");StringReplace(s,"\n","\\n");return s;}
string S(string k,string v){return "\""+k+"\":\""+Esc(v)+"\"";}
string N(string k,double v){return "\""+k+"\":"+DoubleToString(v,8);}
string I(string k,long v){return "\""+k+"\":"+(string)v;}
string B(string k,bool v){return "\""+k+"\":"+(v?"true":"false");}

string DetectBroker(){
 string h=AccountInfoString(ACCOUNT_COMPANY)+" "+AccountInfoString(ACCOUNT_SERVER);StringToLower(h);
 if(StringFind(h,"exness")>=0)return "EXNESS";
 if(StringFind(h,"versus")>=0||StringFind(h,"vtmarkets")>=0)return "VERSUS_TRADE";
 return "UNKNOWN";
}
string ResolveGold(){
 if(SymbolSelect(InpPreferredSymbol,true))return InpPreferredSymbol;
 for(int i=0;i<SymbolsTotal(false);i++){string s=SymbolName(i,false),u=s;StringToUpper(u);if(StringFind(u,"XAUUSD")==0&&SymbolSelect(s,true))return s;}
 return "";
}
bool Post(string body,string &response,int &code){
 string headers="Content-Type: application/json\r\n";char data[],result[];StringToCharArray(body,data,0,WHOLE_ARRAY,CP_UTF8);if(ArraySize(data)>0)ArrayResize(data,ArraySize(data)-1);
 string rh;ResetLastError();code=WebRequest("POST",InpBridgeUrl,headers,12000,data,result,rh);
 if(code==-1){g_status="WebRequest error "+(string)GetLastError()+"; allow bridge URL in MT5 Options";response="";return false;}
 response=CharArrayToString(result,0,WHOLE_ARRAY,CP_UTF8);return code>=200&&code<300;
}
string GetJsonString(string j,string key){
 string m="\""+key+"\":";int p=StringFind(j,m);if(p<0)return "";p+=StringLen(m);
 while(p<StringLen(j)&&(StringGetCharacter(j,p)==' '||StringGetCharacter(j,p)=='\"'))p++;
 int e=StringFind(j,"\"",p);if(e<0)return "";return StringSubstr(j,p,e-p);
}
bool SaveToken(string t){int h=FileOpen("RitelAI_MT5_device_token.txt",FILE_WRITE|FILE_TXT|FILE_ANSI);if(h==INVALID_HANDLE)return false;FileWriteString(h,t);FileClose(h);return true;}
string LoadToken(){int h=FileOpen("RitelAI_MT5_device_token.txt",FILE_READ|FILE_TXT|FILE_ANSI);if(h==INVALID_HANDLE)return "";string t=FileReadString(h);FileClose(h);return t;}

bool Pair(){
 if(InpPairingCode==""){g_status="Pairing code belum diisi.";return false;}
 string p=InpAccountProfile==EXNESS_STANDARD_CENT?"STANDARD_CENT":"STANDARD";
 string body="{"+S("action","pair_terminal")+","+S("pairing_code",InpPairingCode)+","+S("broker",g_broker)+","+S("account_profile",p)+","+B("is_demo",g_demo)+","+S("server",AccountInfoString(ACCOUNT_SERVER))+","+S("login",(string)AccountInfoInteger(ACCOUNT_LOGIN))+","+S("symbol",g_symbol)+","+I("digits",SymbolInfoInteger(g_symbol,SYMBOL_DIGITS))+","+N("contract_size",SymbolInfoDouble(g_symbol,SYMBOL_TRADE_CONTRACT_SIZE))+","+N("volume_min",SymbolInfoDouble(g_symbol,SYMBOL_VOLUME_MIN))+","+N("volume_max",SymbolInfoDouble(g_symbol,SYMBOL_VOLUME_MAX))+","+N("volume_step",SymbolInfoDouble(g_symbol,SYMBOL_VOLUME_STEP))+"}";
 string r;int c;if(!Post(body,r,c)){g_status="Pairing HTTP "+(string)c+": "+r;return false;}
 string t=GetJsonString(r,"device_token");if(t==""){g_status="Pairing ditolak: "+r;return false;}
 if(!SaveToken(t)){g_status="Token diterima tetapi gagal disimpan lokal.";return false;}
 g_token=t;g_status="Pairing berhasil; token tersimpan lokal.";return true;
}
void Heartbeat(){
 if(g_token=="")return;
 string body="{"+S("action","heartbeat")+","+S("device_token",g_token)+","+B("is_demo",g_demo)+","+S("symbol",g_symbol)+","+I("digits",SymbolInfoInteger(g_symbol,SYMBOL_DIGITS))+","+N("contract_size",SymbolInfoDouble(g_symbol,SYMBOL_TRADE_CONTRACT_SIZE))+","+N("volume_min",SymbolInfoDouble(g_symbol,SYMBOL_VOLUME_MIN))+","+N("volume_max",SymbolInfoDouble(g_symbol,SYMBOL_VOLUME_MAX))+","+N("volume_step",SymbolInfoDouble(g_symbol,SYMBOL_VOLUME_STEP))+"}";
 string r;int c;if(Post(body,r,c))g_status="Heartbeat OK — DEMO ONLY.";else g_status="Heartbeat HTTP "+(string)c+": "+r;
}
void Poll(){
 if(g_token=="")return;string r;int c;
 if(Post("{"+S("action","poll")+","+S("device_token",g_token)+"}",r,c)){
  if(StringFind(r,"\"signals\":[]")>=0)g_status="Connected; no pending signals. DEMO ONLY.";
  else g_status="Signal inbox contains item(s); review only, no execution.";
  Print("RitelAI inbox: ",r);
 }else g_status="Poll HTTP "+(string)c+": "+r;
}
void Panel(){
 string m="RitelAI MT5 Connector 0.2.1\nBroker: "+g_broker+" | Profile: "+g_profile+"\nServer: "+AccountInfoString(ACCOUNT_SERVER)+"\nLogin: "+(string)AccountInfoInteger(ACCOUNT_LOGIN)+" | Demo: "+(g_demo?"YES":"NO")+"\nXAUUSD: "+g_symbol+"\nBridge: "+g_status+"\n\nSAFE MODE: NO ORDERS WILL BE SENT.";
 Comment(m);
}
int OnInit(){
 g_demo=AccountInfoInteger(ACCOUNT_TRADE_MODE)==ACCOUNT_TRADE_MODE_DEMO;g_broker=DetectBroker();g_profile=InpAccountProfile==EXNESS_STANDARD_CENT?"STANDARD_CENT":"STANDARD";g_symbol=ResolveGold();
 if(InpRequireDemoAccount&&!g_demo){Print("RitelAI STOP: DEMO required.");return INIT_FAILED;}
 if(g_broker=="UNKNOWN"){Print("RitelAI STOP: broker not recognized.");return INIT_FAILED;}
 if((g_broker=="EXNESS"&&g_profile!="STANDARD_CENT")||(g_broker=="VERSUS_TRADE"&&g_profile!="STANDARD")){Print("RitelAI STOP: selected profile mismatch.");return INIT_FAILED;}
 if(g_symbol==""){Print("RitelAI STOP: XAUUSD not found.");return INIT_FAILED;}
 g_token=LoadToken();if(g_token=="")Pair();EventSetTimer(MathMax(5,InpPollSeconds));Panel();return INIT_SUCCEEDED;
}
void OnTimer(){if(g_token=="")Pair();else{Heartbeat();Poll();}Panel();}
void OnDeinit(const int reason){EventKillTimer();Comment("");}
// No CTrade, OrderSend, Buy, Sell, or pending-order execution code.

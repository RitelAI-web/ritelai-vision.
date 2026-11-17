//+------------------------------------------------------------------+
//| RitelAI MT5 REAL Connector - Monitor Only                         |
//| Pairs a REAL account and sends heartbeat/status. NO order code.  |
//+------------------------------------------------------------------+
#property strict
#property version   "1.0"
#property description "RitelAI REAL monitor-only connector. Never places or modifies orders."

enum RITELAI_REAL_PROFILE { REAL_CENT=0, REAL_STANDARD=1, REAL_ZERO=2, REAL_PRO=3, REAL_RAW=4, REAL_ECN=5, REAL_OTHER=6 };
input string InpBridgeUrl="https://brfssdpplapefjmxnpft.supabase.co/functions/v1/mt5-bridge";
input string InpPairingCode="";
input string InpBroker="VERSUS_TRADE";
input RITELAI_REAL_PROFILE InpAccountProfile=REAL_STANDARD;
input string InpPreferredSymbol="XAUUSD.s";
input int InpPollSeconds=10;

string g_profile="",g_symbol="",g_token="",g_status="Starting";
string Esc(string s){StringReplace(s,"\\","\\\\");StringReplace(s,"\"","\\\"");StringReplace(s,"\r","\\r");StringReplace(s,"\n","\\n");return s;}
string S(string k,string v){return "\""+k+"\":\""+Esc(v)+"\"";}
string N(string k,double v){return "\""+k+"\":"+DoubleToString(v,8);}
string I(string k,long v){return "\""+k+"\":"+(string)v;}
string B(string k,bool v){return "\""+k+"\":"+(v?"true":"false");}
string ProfileName(){
 switch(InpAccountProfile){
  case REAL_CENT:return "STANDARD_CENT";
  case REAL_ZERO:return "ZERO";
  case REAL_PRO:return "PRO";
  case REAL_RAW:return "RAW";
  case REAL_ECN:return "ECN";
  case REAL_OTHER:return "OTHER";
  default:return "STANDARD";
 }
}
string TokenFile(){return "RitelAI_REAL_"+(string)AccountInfoInteger(ACCOUNT_LOGIN)+".txt";}
bool SaveToken(string t){int h=FileOpen(TokenFile(),FILE_WRITE|FILE_TXT|FILE_ANSI);if(h==INVALID_HANDLE)return false;FileWriteString(h,t);FileClose(h);return true;}
string LoadToken(){int h=FileOpen(TokenFile(),FILE_READ|FILE_TXT|FILE_ANSI);if(h==INVALID_HANDLE)return "";string t=FileReadString(h);FileClose(h);return t;}
bool Post(string body,string &response,int &code){
 string headers="Content-Type: application/json\r\n";char data[],result[];
 StringToCharArray(body,data,0,WHOLE_ARRAY,CP_UTF8);if(ArraySize(data)>0)ArrayResize(data,ArraySize(data)-1);
 string rh;ResetLastError();code=WebRequest("POST",InpBridgeUrl,headers,12000,data,result,rh);
 if(code==-1){g_status="WebRequest error "+(string)GetLastError()+"; allow bridge URL in MT5 Options";response="";return false;}
 response=CharArrayToString(result,0,WHOLE_ARRAY,CP_UTF8);return code>=200&&code<300;
}
string GetJsonString(string j,string key){
 string m="\""+key+"\":";int p=StringFind(j,m);if(p<0)return "";p+=StringLen(m);
 while(p<StringLen(j)&&(StringGetCharacter(j,p)==' '||StringGetCharacter(j,p)=='\"'))p++;
 int e=StringFind(j,"\"",p);if(e<0)return "";return StringSubstr(j,p,e-p);
}
string ResolveSymbol(){
 if(SymbolSelect(InpPreferredSymbol,true))return InpPreferredSymbol;
 for(int i=0;i<SymbolsTotal(false);i++){string s=SymbolName(i,false),u=s;StringToUpper(u);if(StringFind(u,"XAUUSD")==0&&SymbolSelect(s,true))return s;}
 return "";
}
bool Pair(){
 if(InpPairingCode==""){g_status="Masukkan kode pairing REAL dari website.";return false;}
 string body="{"+S("action","pair_terminal")+","+S("pairing_code",InpPairingCode)+","+S("broker",InpBroker)+","+S("account_profile",g_profile)+","+B("is_demo",false)+","+S("server",AccountInfoString(ACCOUNT_SERVER))+","+S("login",(string)AccountInfoInteger(ACCOUNT_LOGIN))+","+S("symbol",g_symbol)+","+I("digits",SymbolInfoInteger(g_symbol,SYMBOL_DIGITS))+","+N("contract_size",SymbolInfoDouble(g_symbol,SYMBOL_TRADE_CONTRACT_SIZE))+","+N("volume_min",SymbolInfoDouble(g_symbol,SYMBOL_VOLUME_MIN))+","+N("volume_max",SymbolInfoDouble(g_symbol,SYMBOL_VOLUME_MAX))+","+N("volume_step",SymbolInfoDouble(g_symbol,SYMBOL_VOLUME_STEP))+"}";
 string r;int c;if(!Post(body,r,c)){g_status="Pairing HTTP "+(string)c+": "+r;return false;}
 string t=GetJsonString(r,"device_token");if(t==""){g_status="Pairing ditolak: "+r;return false;}
 if(!SaveToken(t)){g_status="Token diterima tetapi gagal disimpan lokal.";return false;}
 g_token=t;g_status="REAL paired; monitor-only token saved.";return true;
}
void Heartbeat(){
 string body="{"+S("action","heartbeat")+","+S("device_token",g_token)+","+B("is_demo",false)+","+S("symbol",g_symbol)+","+I("digits",SymbolInfoInteger(g_symbol,SYMBOL_DIGITS))+","+N("contract_size",SymbolInfoDouble(g_symbol,SYMBOL_TRADE_CONTRACT_SIZE))+","+N("volume_min",SymbolInfoDouble(g_symbol,SYMBOL_VOLUME_MIN))+","+N("volume_max",SymbolInfoDouble(g_symbol,SYMBOL_VOLUME_MAX))+","+N("volume_step",SymbolInfoDouble(g_symbol,SYMBOL_VOLUME_STEP))+","+S("account_currency",AccountInfoString(ACCOUNT_CURRENCY))+","+N("leverage",(double)AccountInfoInteger(ACCOUNT_LEVERAGE))+"}";
 string r;int c;if(Post(body,r,c))g_status="REAL heartbeat OK; monitor-only.";else g_status="Heartbeat HTTP "+(string)c+": "+r;
}
void Poll(){
 string r;int c;if(Post("{"+S("action","poll")+","+S("device_token",g_token)+"}",r,c)){
  if(StringFind(r,"real_linked_safe_mode")>=0)g_status="REAL LINKED — MONITOR ONLY; order execution LOCKED.";
  else g_status="Poll response: "+r;
 }else g_status="Poll HTTP "+(string)c+": "+r;
}
void Panel(){
 Comment("RitelAI MT5 REAL Connector 1.0\nBroker: ",InpBroker," | Profile: ",g_profile,
 "\nServer: ",AccountInfoString(ACCOUNT_SERVER),"\nLogin: ",AccountInfoInteger(ACCOUNT_LOGIN),
 "\nAccount mode: REAL\nSymbol: ",g_symbol,"\nBridge: ",g_status,
 "\n\nSAFETY: MONITOR ONLY — NO ORDERS CAN BE PLACED.");
}
int OnInit(){
 if(AccountInfoInteger(ACCOUNT_TRADE_MODE)!=ACCOUNT_TRADE_MODE_REAL){Print("RitelAI REAL Connector: REAL account required; initialization stopped.");return INIT_FAILED;}
 if(InpBroker!="VERSUS_TRADE"&&InpBroker!="EXNESS"){Print("Unsupported broker identifier.");return INIT_PARAMETERS_INCORRECT;}
 g_profile=ProfileName();g_symbol=ResolveSymbol();
 if(g_symbol==""){Print("XAUUSD symbol not found.");return INIT_FAILED;}
 g_token=LoadToken();
 if(g_token=="")Pair();
 EventSetTimer(MathMax(10,InpPollSeconds));Panel();
 Print("RitelAI REAL monitor-only connector initialized. It cannot place or modify trades.");
 return INIT_SUCCEEDED;
}
void OnTimer(){
 if(AccountInfoInteger(ACCOUNT_TRADE_MODE)!=ACCOUNT_TRADE_MODE_REAL){g_status="Account mode changed; stopped.";EventKillTimer();Panel();return;}
 if(g_token==""){Pair();}else{Heartbeat();Poll();}
 Panel();
}
void OnDeinit(const int reason){EventKillTimer();Comment("");}
// Intentionally no Trade.mqh, CTrade, OrderSend, Buy, Sell or order modification functions.

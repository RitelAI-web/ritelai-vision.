//+------------------------------------------------------------------+
//| RitelAI MT5 Connector - Broker Preflight (SAFE BUILD)             |
//| Supports Exness Standard Cent and Versus Trade Standard profiles. |
//| This build DOES NOT place, modify, or close trades.               |
//+------------------------------------------------------------------+
#property strict
#property version   "0.1.0"
#property description "RitelAI broker/symbol preflight. Trading disabled in this build."

input string InpPreferredSymbol = "XAUUSD";
input bool   InpRequireDemoAccount = true;
input bool   InpShowDiagnostics = true;

string g_broker = "UNKNOWN";
string g_account_type = "UNKNOWN";
string g_symbol = "";
bool   g_demo = false;

string DetectBroker()
{
   string company = AccountInfoString(ACCOUNT_COMPANY);
   string server  = AccountInfoString(ACCOUNT_SERVER);
   string hay = company + " " + server;
   StringToLower(hay);
   if(StringFind(hay,"exness") >= 0) return "EXNESS";
   if(StringFind(hay,"versus") >= 0 || StringFind(hay,"vtmarkets") >= 0) return "VERSUS_TRADE";
   return "UNRECOGNIZED";
}

string ResolveGoldSymbol()
{
   // Resolve broker-specific suffixes using symbols actually available in this terminal.
   if(SymbolSelect(InpPreferredSymbol,true)) return InpPreferredSymbol;
   int total = SymbolsTotal(false);
   for(int i=0;i<total;i++)
   {
      string candidate=SymbolName(i,false);
      string upper=candidate;
      StringToUpper(upper);
      if(StringFind(upper,"XAUUSD")==0 && SymbolSelect(candidate,true))
         return candidate;
   }
   return "";
}

void ShowStatus()
{
   string msg = "RitelAI MT5 Connector 0.1.0\n";
   msg += "Broker: "+g_broker+"\n";
   msg += "Account: "+g_account_type+"\n";
   msg += "Server: "+AccountInfoString(ACCOUNT_SERVER)+"\n";
   msg += "Login: "+(string)AccountInfoInteger(ACCOUNT_LOGIN)+"\n";
   msg += "Demo: "+(g_demo ? "YES" : "NO")+"\n";
   msg += "Gold symbol: "+(g_symbol=="" ? "NOT FOUND" : g_symbol)+"\n";
   if(g_symbol!="")
   {
      msg += "Digits: "+(string)SymbolInfoInteger(g_symbol,SYMBOL_DIGITS)+"\n";
      msg += "Point: "+DoubleToString(SymbolInfoDouble(g_symbol,SYMBOL_POINT),8)+"\n";
      msg += "Contract size: "+DoubleToString(SymbolInfoDouble(g_symbol,SYMBOL_TRADE_CONTRACT_SIZE),2)+"\n";
      msg += "Volume min/max/step: "+DoubleToString(SymbolInfoDouble(g_symbol,SYMBOL_VOLUME_MIN),2)+
             " / "+DoubleToString(SymbolInfoDouble(g_symbol,SYMBOL_VOLUME_MAX),2)+
             " / "+DoubleToString(SymbolInfoDouble(g_symbol,SYMBOL_VOLUME_STEP),3)+"\n";
      msg += "Trade mode: "+(string)SymbolInfoInteger(g_symbol,SYMBOL_TRADE_MODE)+"\n";
   }
   msg += "\nSAFE MODE: NO ORDERS WILL BE SENT.";
   Comment(msg);
   if(InpShowDiagnostics) Print(msg);
}

int OnInit()
{
   long mode=AccountInfoInteger(ACCOUNT_TRADE_MODE);
   g_demo=(mode==ACCOUNT_TRADE_MODE_DEMO);
   g_broker=DetectBroker();
   g_account_type=(g_broker=="EXNESS" ? "Exness (verify Standard Cent in terminal)" :
                   g_broker=="VERSUS_TRADE" ? "Versus Trade (verify Standard in terminal)" : "Unrecognized broker");
   g_symbol=ResolveGoldSymbol();

   if(InpRequireDemoAccount && !g_demo)
   {
      Print("RitelAI SAFE STOP: account is not DEMO. Connector will not proceed.");
      return INIT_FAILED;
   }
   if(g_broker=="UNRECOGNIZED")
      Print("RitelAI WARNING: broker could not be confidently identified; no trading functions exist in this build.");
   if(g_symbol=="")
      Print("RitelAI WARNING: XAUUSD symbol not found. Check Market Watch and broker symbol naming.");

   EventSetTimer(5);
   ShowStatus();
   return INIT_SUCCEEDED;
}

void OnTimer(){ ShowStatus(); }
void OnDeinit(const int reason){ EventKillTimer(); Comment(""); }
// Intentionally no CTrade, OrderSend, Buy, Sell, or pending-order code.
// This preflight build is for collecting real terminal broker specifications only.

//+------------------------------------------------------------------+
//| RitelAI Auto Trader DEMO v1.3                                    |
//| Local rule-based test EA. DEMO ONLY; not an AI accuracy claim.   |
//+------------------------------------------------------------------+
#property strict
#property version   "1.30"
#property description "RitelAI XAUUSD demo strategy: EMA + RSI + MACD + ATR risk controls"

#include <Trade/Trade.mqh>
CTrade trade;

input string InpSymbol = "XAUUSD.s";
input ENUM_TIMEFRAMES InpTimeframe = PERIOD_M5;
input double InpRiskPercent = 0.5;          // Hard cap: 0.5% equity per trade
input double InpDailyLossLimitPct = 1.0;   // Conservative daily equity-loss cap
input int InpMaxSpreadPoints = 80;
input ulong InpMagic = 26111701;
input int InpFastEMA = 20;
input int InpSlowEMA = 50;
input int InpRSIPeriod = 14;
input int InpATRPeriod = 14;
input double InpSL_Pips = 50.0;           // User-selected fixed stop distance
input double InpPipSize = 0.01;           // Explicit symbol pip size; verify against broker contract
input double InpMinRewardRisk = 1.5;       // Automatic TP floor: 1.5R
input double InpTP_ATR = 2.25;             // TP may extend farther when ATR requires it
input bool InpRequireDemo = true;

int hFast=INVALID_HANDLE, hSlow=INVALID_HANDLE, hRSI=INVALID_HANDLE;
int hMACD=INVALID_HANDLE, hATR=INVALID_HANDLE;
datetime lastBar=0;
double dayStartEquity=0;
int dayKey=0;
bool halted=false;

int DateKey(datetime t) {
   MqlDateTime d; TimeToStruct(t,d);
   return d.year*10000+d.mon*100+d.day;
}
string DayKeyName() { return "RitelAI_DayStart_"+(string)AccountInfoInteger(ACCOUNT_LOGIN)+"_"+(string)DateKey(TimeCurrent()); }

bool IsNewBar() {
   datetime t=iTime(InpSymbol,InpTimeframe,0);
   if(t==0 || t==lastBar) return false;
   lastBar=t; return true;
}
bool ReadOne(int handle,int buffer,int shift,double &value) {
   double a[]; ArraySetAsSeries(a,true);
   if(CopyBuffer(handle,buffer,shift,1,a)!=1) return false;
   value=a[0]; return MathIsValidNumber(value);
}
double NormalizeVolume(double v) {
   double step=SymbolInfoDouble(InpSymbol,SYMBOL_VOLUME_STEP);
   double vmin=SymbolInfoDouble(InpSymbol,SYMBOL_VOLUME_MIN);
   double vmax=SymbolInfoDouble(InpSymbol,SYMBOL_VOLUME_MAX);
   if(step<=0) return 0;
   v=MathFloor(v/step)*step;
   v=MathMin(v,vmax);
   if(v<vmin) return 0; // Never round risk upward to broker minimum.
   int digits=2;
   if(step<0.01) digits=3;
   if(step<0.001) digits=4;
   return NormalizeDouble(v,digits);
}
double CalcLots(double entry,double sl) {
   double riskMoney=AccountInfoDouble(ACCOUNT_EQUITY)*InpRiskPercent/100.0;
   double tickSize=SymbolInfoDouble(InpSymbol,SYMBOL_TRADE_TICK_SIZE);
   double tickValue=SymbolInfoDouble(InpSymbol,SYMBOL_TRADE_TICK_VALUE_LOSS);
   if(tickValue<=0) tickValue=SymbolInfoDouble(InpSymbol,SYMBOL_TRADE_TICK_VALUE);
   double distance=MathAbs(entry-sl);
   if(riskMoney<=0 || tickSize<=0 || tickValue<=0 || distance<=0) return 0;
   double lossPerLot=(distance/tickSize)*tickValue;
   if(lossPerLot<=0) return 0;
   return NormalizeVolume(riskMoney/lossPerLot);
}
bool HasOurPosition() {
   for(int i=PositionsTotal()-1;i>=0;i--) {
      ulong ticket=PositionGetTicket(i);
      if(ticket>0 && PositionGetString(POSITION_SYMBOL)==InpSymbol &&
         (ulong)PositionGetInteger(POSITION_MAGIC)==InpMagic) return true;
   }
   return false;
}
void RefreshDailyLimit() {
   int k=DateKey(TimeCurrent());
   if(k!=dayKey) {
      dayKey=k;
      string key=DayKeyName();
      if(GlobalVariableCheck(key)) dayStartEquity=GlobalVariableGet(key);
      else {
         dayStartEquity=AccountInfoDouble(ACCOUNT_EQUITY);
         GlobalVariableSet(key,dayStartEquity);
      }
      halted=false;
   }
   if(dayStartEquity>0) {
      double dd=(dayStartEquity-AccountInfoDouble(ACCOUNT_EQUITY))/dayStartEquity*100.0;
      if(dd>=InpDailyLossLimitPct) halted=true;
   }
}
void EvaluateAndTrade() {
   // Diagnostics are emitted once per newly closed M5 candle, not every timer tick.
   if(!IsNewBar()) return;
   if(halted) { Print("RitelAI WAIT: daily equity-loss limit reached; new entries halted."); return; }
   if(HasOurPosition()) { Print("RitelAI WAIT: an existing RitelAI position is still open."); return; }
   MqlTick tick;
   if(!SymbolInfoTick(InpSymbol,tick) || tick.ask<=0 || tick.bid<=0) {
      Print("RitelAI WAIT: no valid live tick for ",InpSymbol,"."); return;
   }
   double point=SymbolInfoDouble(InpSymbol,SYMBOL_POINT);
   if(point<=0) { Print("RitelAI WAIT: broker point size unavailable."); return; }
   double spreadPoints=(tick.ask-tick.bid)/point;
   if(spreadPoints>InpMaxSpreadPoints) {
      Print("RitelAI WAIT: spread ",DoubleToString(spreadPoints,1),
            " points exceeds limit ",InpMaxSpreadPoints,"."); return;
   }

   double fast,slow,rsi,macdMain,macdSignal,atr;
   if(!ReadOne(hFast,0,1,fast) || !ReadOne(hSlow,0,1,slow) ||
      !ReadOne(hRSI,0,1,rsi) || !ReadOne(hMACD,0,1,macdMain) ||
      !ReadOne(hMACD,1,1,macdSignal) || !ReadOne(hATR,0,1,atr) || atr<=0) {
      Print("RitelAI WAIT: indicator data not ready; waiting for more M5 history.");
      return;
   }

   bool emaBull=(fast>slow), emaBear=(fast<slow);
   bool rsiBull=(rsi>=55.0), rsiBear=(rsi<=45.0);
   bool macdBull=(macdMain>macdSignal), macdBear=(macdMain<macdSignal);
   bool buy=(emaBull && rsiBull && macdBull);
   bool sell=(emaBear && rsiBear && macdBear);
   Print("RitelAI CHECK ",InpSymbol," M5 | EMA",InpFastEMA,"=",DoubleToString(fast,_Digits),
         " EMA",InpSlowEMA,"=",DoubleToString(slow,_Digits),
         " RSI=",DoubleToString(rsi,1),
         " MACD=",DoubleToString(macdMain,5),
         " signal=",DoubleToString(macdSignal,5),
         " ATR=",DoubleToString(atr,_Digits),
         " spread=",DoubleToString(spreadPoints,1),
         " | BUY[EMA:",emaBull," RSI:",rsiBull," MACD:",macdBull,
         "] SELL[EMA:",emaBear," RSI:",rsiBear," MACD:",macdBear,"]");
   if(!buy && !sell) {
      Print("RitelAI WAIT: no complete BUY/SELL setup on the last closed candle.");
      return;
   }

   int digits=(int)SymbolInfoInteger(InpSymbol,SYMBOL_DIGITS);
   double entry=buy?tick.ask:tick.bid;
   // Fixed 50-pip SL; pip size is explicit because broker symbol conventions differ.
   double slDistance=InpSL_Pips*InpPipSize;
   double tpDistance=MathMax(slDistance*InpMinRewardRisk,InpTP_ATR*atr);
   double sl=buy?entry-slDistance:entry+slDistance;
   double tp=buy?entry+tpDistance:entry-tpDistance;
   sl=NormalizeDouble(sl,digits); tp=NormalizeDouble(tp,digits);
   // Broker-side trade permissions and stop-distance preflight.
   if(!TerminalInfoInteger(TERMINAL_CONNECTED) ||
      !TerminalInfoInteger(TERMINAL_TRADE_ALLOWED) ||
      !MQLInfoInteger(MQL_TRADE_ALLOWED) ||
      !AccountInfoInteger(ACCOUNT_TRADE_ALLOWED)) {
      Print("RitelAI STOP: terminal/account trading permission unavailable.");
      return;
   }
   long symbolMode=SymbolInfoInteger(InpSymbol,SYMBOL_TRADE_MODE);
   if(symbolMode==SYMBOL_TRADE_MODE_DISABLED ||
      (buy && symbolMode==SYMBOL_TRADE_MODE_SHORTONLY) ||
      (!buy && symbolMode==SYMBOL_TRADE_MODE_LONGONLY) ||
      symbolMode==SYMBOL_TRADE_MODE_CLOSEONLY) {
      Print("RitelAI STOP: broker symbol trade mode blocks this direction.");
      return;
   }
   double stopLevel=SymbolInfoInteger(InpSymbol,SYMBOL_TRADE_STOPS_LEVEL)*point;
   if((buy && (entry-sl<stopLevel || tp-entry<stopLevel)) ||
      (!buy && (sl-entry<stopLevel || entry-tp<stopLevel))) {
      Print("RitelAI STOP: SL/TP is inside broker minimum stop distance.");
      return;
   }

   double lots=CalcLots(entry,sl);
   if(lots<=0) { Print("RitelAI: volume below broker minimum or risk calculation unavailable; skipped."); return; }

   // Reject trades that cannot be covered by available free margin.
   double requiredMargin=0;
   ENUM_ORDER_TYPE orderType=buy?ORDER_TYPE_BUY:ORDER_TYPE_SELL;
   if(!OrderCalcMargin(orderType,InpSymbol,lots,entry,requiredMargin) ||
      requiredMargin<=0 || AccountInfoDouble(ACCOUNT_MARGIN_FREE)<requiredMargin) {
      Print("RitelAI STOP: margin preflight failed; order skipped.");
      return;
   }

   trade.SetExpertMagicNumber(InpMagic);
   trade.SetDeviationInPoints(20);
   trade.SetTypeFillingBySymbol(InpSymbol);
   bool sent=buy?trade.Buy(lots,InpSymbol,0,sl,tp,"RitelAI DEMO EMA RSI MACD"):
                 trade.Sell(lots,InpSymbol,0,sl,tp,"RitelAI DEMO EMA RSI MACD");
   uint rc=trade.ResultRetcode();
   bool accepted=(rc==TRADE_RETCODE_DONE || rc==TRADE_RETCODE_DONE_PARTIAL ||
                  rc==TRADE_RETCODE_PLACED);
   if(!sent || !accepted) {
      Print("RitelAI ORDER NOT CONFIRMED: signal=",buy?"BUY":"SELL",
            " retcode=",rc," ",trade.ResultRetcodeDescription(),
            " sent=",sent);
      return;
   }
   Print("RitelAI DEMO ORDER CONFIRMED: signal=",buy?"BUY":"SELL",
         " lots=",lots," entry=",entry," SL=",sl," TP=",tp,
         " retcode=",rc," ",trade.ResultRetcodeDescription());
}
int OnInit() {
   if(InpRequireDemo && AccountInfoInteger(ACCOUNT_TRADE_MODE)!=ACCOUNT_TRADE_MODE_DEMO) {
      Print("RitelAI STOP: DEMO account required. No trading.");
      return INIT_FAILED;
   }
   if(InpRiskPercent<=0 || InpRiskPercent>0.5 || InpDailyLossLimitPct<=0 ||
      InpDailyLossLimitPct>1.0 || InpMaxSpreadPoints<1 || InpMaxSpreadPoints>80 ||
      InpSL_Pips<=0 || InpPipSize<=0 || InpMinRewardRisk<1.5 || InpTP_ATR<=0) {
      Print("RitelAI STOP: risk settings exceed hard safety limits.");
      return INIT_PARAMETERS_INCORRECT;
   }
   if(!SymbolSelect(InpSymbol,true)) {
      Print("RitelAI STOP: symbol not available: ",InpSymbol);
      return INIT_FAILED;
   }
   hFast=iMA(InpSymbol,InpTimeframe,InpFastEMA,0,MODE_EMA,PRICE_CLOSE);
   hSlow=iMA(InpSymbol,InpTimeframe,InpSlowEMA,0,MODE_EMA,PRICE_CLOSE);
   hRSI=iRSI(InpSymbol,InpTimeframe,InpRSIPeriod,PRICE_CLOSE);
   hMACD=iMACD(InpSymbol,InpTimeframe,12,26,9,PRICE_CLOSE);
   hATR=iATR(InpSymbol,InpTimeframe,InpATRPeriod);
   if(hFast==INVALID_HANDLE || hSlow==INVALID_HANDLE || hRSI==INVALID_HANDLE ||
      hMACD==INVALID_HANDLE || hATR==INVALID_HANDLE) {
      Print("RitelAI STOP: indicator initialization failed."); return INIT_FAILED;
   }
   dayKey=DateKey(TimeCurrent());
   string key=DayKeyName();
   if(GlobalVariableCheck(key)) dayStartEquity=GlobalVariableGet(key);
   else { dayStartEquity=AccountInfoDouble(ACCOUNT_EQUITY); GlobalVariableSet(key,dayStartEquity); }
   EventSetTimer(2);
   Print("RitelAI Auto Trader DEMO v1.3 initialized | SL=",InpSL_Pips," pips | minimum TP RR=",InpMinRewardRisk,":1 | risk=",InpRiskPercent,"% | daily cap=",InpDailyLossLimitPct,"%. Rule-based; no profit guarantee.");
   return INIT_SUCCEEDED;
}
void OnTimer() { RefreshDailyLimit(); EvaluateAndTrade(); }
void OnDeinit(const int reason) {
   EventKillTimer();
   if(hFast!=INVALID_HANDLE) IndicatorRelease(hFast);
   if(hSlow!=INVALID_HANDLE) IndicatorRelease(hSlow);
   if(hRSI!=INVALID_HANDLE) IndicatorRelease(hRSI);
   if(hMACD!=INVALID_HANDLE) IndicatorRelease(hMACD);
   if(hATR!=INVALID_HANDLE) IndicatorRelease(hATR);
   Comment("");
}
